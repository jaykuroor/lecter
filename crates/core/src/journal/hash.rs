//! BLAKE3 (default hash mode, 32-byte output) for the journal's `base` field
//! (`18-contracts.md#journal-records`). The `blake3` crate needs a native build step, which the
//! dependency policy sends to the maintainer, so this is the portable algorithm from the BLAKE3
//! specification, checked against the official crate's output in the tests. The lecture files it
//! hashes are at most 16 MB, so speed doesn't matter here.

const IV: [u32; 8] =
    [0x6A09_E667, 0xBB67_AE85, 0x3C6E_F372, 0xA54F_F53A, 0x510E_527F, 0x9B05_688C, 0x1F83_D9AB, 0x5BE0_CD19];
const MSG_PERMUTATION: [usize; 16] = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const BLOCK_LEN: usize = 64;
const CHUNK_LEN: usize = 1024;
const CHUNK_START: u32 = 1;
const CHUNK_END: u32 = 2;
const PARENT: u32 = 4;
const ROOT: u32 = 8;

/// The quarter-round on columns or diagonals of the state.
fn g(s: &mut [u32; 16], (a, b, c, d): (usize, usize, usize, usize), mx: u32, my: u32) {
    s[a] = s[a].wrapping_add(s[b]).wrapping_add(mx);
    s[d] = (s[d] ^ s[a]).rotate_right(16);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_right(12);
    s[a] = s[a].wrapping_add(s[b]).wrapping_add(my);
    s[d] = (s[d] ^ s[a]).rotate_right(8);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_right(7);
}

fn round(s: &mut [u32; 16], m: &[u32; 16]) {
    g(s, (0, 4, 8, 12), m[0], m[1]);
    g(s, (1, 5, 9, 13), m[2], m[3]);
    g(s, (2, 6, 10, 14), m[4], m[5]);
    g(s, (3, 7, 11, 15), m[6], m[7]);
    g(s, (0, 5, 10, 15), m[8], m[9]);
    g(s, (1, 6, 11, 12), m[10], m[11]);
    g(s, (2, 7, 8, 13), m[12], m[13]);
    g(s, (3, 4, 9, 14), m[14], m[15]);
}

/// The compression function; the first 8 words are the new chaining value.
fn compress(cv: &[u32; 8], block: &[u32; 16], counter: u64, block_len: u32, flags: u32) -> [u32; 16] {
    let c = counter.to_le_bytes();
    let (lo, hi) = (u32::from_le_bytes([c[0], c[1], c[2], c[3]]), u32::from_le_bytes([c[4], c[5], c[6], c[7]]));
    let mut s =
        [cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7], IV[0], IV[1], IV[2], IV[3], lo, hi, block_len, flags];
    let mut m = *block;
    for r in 0..7 {
        // The message words are permuted between rounds.
        if r > 0 {
            m = std::array::from_fn(|i| m[MSG_PERMUTATION[i]]);
        }
        round(&mut s, &m);
    }
    for i in 0..8 {
        s[i] ^= s[i + 8];
        s[i + 8] ^= cv[i];
    }
    s
}

/// Up to 64 bytes as 16 little-endian words, zero-padded.
fn words(bytes: &[u8]) -> [u32; 16] {
    let mut padded = [0u8; BLOCK_LEN];
    padded[..bytes.len()].copy_from_slice(bytes);
    std::array::from_fn(|i| {
        u32::from_le_bytes([padded[4 * i], padded[4 * i + 1], padded[4 * i + 2], padded[4 * i + 3]])
    })
}

fn first8(w: &[u32; 16]) -> [u32; 8] {
    std::array::from_fn(|i| w[i])
}

/// A node's last compression, not yet run: as a chaining value, or with `ROOT` as the hash.
struct Output {
    cv: [u32; 8],
    block: [u32; 16],
    counter: u64,
    block_len: u32,
    flags: u32,
}

impl Output {
    fn chaining_value(&self) -> [u32; 8] {
        first8(&compress(&self.cv, &self.block, self.counter, self.block_len, self.flags))
    }

    fn root(&self) -> [u32; 8] {
        first8(&compress(&self.cv, &self.block, self.counter, self.block_len, self.flags | ROOT))
    }
}

/// One chunk (at most 1024 bytes, possibly empty) with its index in the input.
fn chunk_output(chunk: &[u8], index: u64) -> Output {
    let mut cv = IV;
    let mut blocks = chunk.chunks(BLOCK_LEN).peekable();
    let mut flags = CHUNK_START;
    loop {
        let block = blocks.next().unwrap_or(&[]);
        if blocks.peek().is_none() {
            #[allow(clippy::cast_possible_truncation, reason = "a block is at most 64 bytes")]
            let block_len = block.len() as u32;
            return Output { cv, block: words(block), counter: index, block_len, flags: flags | CHUNK_END };
        }
        cv = first8(&compress(&cv, &words(block), index, BLOCK_LEN as u32, flags));
        flags = 0;
    }
}

fn parent_output(left: &[u32; 8], right: &[u32; 8]) -> Output {
    let block = std::array::from_fn(|i| if i < 8 { left[i] } else { right[i - 8] });
    Output { cv: IV, block, counter: 0, block_len: BLOCK_LEN as u32, flags: PARENT }
}

/// The BLAKE3 hash of `input`, as 64 lower-case hex digits.
pub fn blake3_hex(input: &[u8]) -> String {
    let mut chunks: Vec<&[u8]> = input.chunks(CHUNK_LEN).collect();
    let last = chunks.pop().unwrap_or(&[]);
    // The chaining values of completed subtrees, merged like a binary counter.
    let mut stack: Vec<[u32; 8]> = Vec::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let mut cv = chunk_output(chunk, i as u64).chaining_value();
        let mut total = i as u64 + 1;
        while total & 1 == 0 {
            if let Some(left) = stack.pop() {
                cv = parent_output(&left, &cv).chaining_value();
            }
            total >>= 1;
        }
        stack.push(cv);
    }
    let mut output = chunk_output(last, chunks.len() as u64);
    while let Some(left) = stack.pop() {
        output = parent_output(&left, &output.chaining_value());
    }
    output.root().iter().flat_map(|w| w.to_le_bytes()).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::blake3_hex;

    /// The official `blake3` crate (1.8.7) on the BLAKE3 test-vector input (byte i is i mod 251),
    /// at the chunk and tree boundaries: one block, one chunk, two chunks, and trees 3–100 chunks deep.
    const VECTORS: &[(usize, &str)] = &[
        (0, "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"),
        (1, "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213"),
        (2, "7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63"),
        (3, "e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f"),
        (63, "e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b"),
        (64, "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98"),
        (65, "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee"),
        (127, "d81293fda863f008c09e92fc382a81f5a0b4a1251cba1634016a0f86a6bd640d"),
        (128, "f17e570564b26578c33bb7f44643f539624b05df1a76c81f30acd548c44b45ef"),
        (129, "683aaae9f3c5ba37eaaf072aed0f9e30bac0865137bae68b1fde4ca2aebdcb12"),
        (1023, "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11"),
        (1024, "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7"),
        (1025, "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444"),
        (2048, "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a"),
        (2049, "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030"),
        (3072, "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2"),
        (3073, "7124b49501012f81cc7f11ca069ec9226cecb8a2c850cfe644e327d22d3e1cd3"),
        (4096, "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969"),
        (4097, "9b4052b38f1c5fc8b1f9ff7ac7b27cd242487b3d890d15c96a1c25b8aa0fb995"),
        (5120, "9cadc15fed8b5d854562b26a9536d9707cadeda9b143978f319ab34230535833"),
        (5121, "628bd2cb2004694adaab7bbd778a25df25c47b9d4155a55f8fbd79f2fe154cff"),
        (6144, "3e2e5b74e048f3add6d21faab3f83aa44d3b2278afb83b80b3c35164ebeca205"),
        (6145, "f1323a8631446cc50536a9f705ee5cb619424d46887f3c376c695b70e0f0507f"),
        (7168, "61da957ec2499a95d6b8023e2b0e604ec7f6b50e80a9678b89d2628e99ada77a"),
        (7169, "a003fc7a51754a9b3c7fae0367ab3d782dccf28855a03d435f8cfe74605e7817"),
        (8192, "aae792484c8efe4f19e2ca7d371d8c467ffb10748d8a5a1ae579948f718a2a63"),
        (8193, "bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b"),
        (16384, "f875d6646de28985646f34ee13be9a576fd515f76b5b0a26bb324735041ddde4"),
        (31744, "62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47"),
        (102400, "bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085"),
    ];

    #[test]
    fn matches_the_official_blake3_output_at_every_boundary() {
        for &(len, want) in VECTORS {
            let input: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            assert_eq!(blake3_hex(&input), want, "length {len}");
        }
    }

    #[test]
    fn hashes_text_like_the_blake3_reference() {
        assert_eq!(blake3_hex(b"abc"), "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
    }
}
