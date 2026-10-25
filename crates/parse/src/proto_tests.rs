use super::*;

fn done() -> FromWorker {
    FromWorker::Done {
        blocks: vec![Block {
            id: "s1b1".into(),
            page: 1,
            kind: BlockKind::Paragraph,
            text: "Entropy\nand heat".into(),
            bbox: BBox { x: 72.0, y: 50.5, w: 200.0, h: 30.0 },
            method: Method::TextLayer,
            confidence: 1.0,
        }],
        crops: vec![],
        figures: vec![],
    }
}

#[test]
fn every_message_round_trips_through_both_codecs() {
    let to = [
        ToWorker::Hello { proto_version: PROTO_VERSION },
        ToWorker::Parse { path: "/c/slides/l01.pdf".into(), limits: Limits::default() },
    ];
    let from = [
        FromWorker::Hello { proto_version: 7 },
        FromWorker::Progress { page: 2, pages: 9 },
        done(),
        FromWorker::Failed { code: FailCode::Limit, reason: "over 2000 pages".into() },
    ];
    for codec in [Codec::Json, Codec::Postcard] {
        for m in &to {
            let mut buf = Vec::new();
            write_frame(&mut buf, codec, m).unwrap();
            let back: Option<ToWorker> = read_frame(&mut buf.as_slice(), codec).unwrap();
            assert_eq!(back.as_ref(), Some(m), "{codec:?}");
        }
        for m in &from {
            let mut buf = Vec::new();
            write_frame(&mut buf, codec, m).unwrap();
            let back: Option<FromWorker> = read_frame(&mut buf.as_slice(), codec).unwrap();
            assert_eq!(back.as_ref(), Some(m), "{codec:?}");
        }
    }
}

#[test]
fn a_frame_is_a_little_endian_length_then_the_body() {
    let frame = Codec::Json.encode(&ToWorker::Hello { proto_version: 1 }).unwrap();
    let body = br#"{"Hello":{"proto_version":1}}"#;
    assert_eq!(&frame[..4], &(body.len() as u32).to_le_bytes());
    assert_eq!(&frame[4..], body);
}

#[test]
fn debug_builds_speak_json_and_release_builds_postcard() {
    let want = if cfg!(debug_assertions) { Codec::Json } else { Codec::Postcard };
    assert_eq!(Codec::BUILD, want);
}

#[test]
fn json_names_follow_the_contract() {
    let v: serde_json::Value = serde_json::from_slice(&Codec::Json.encode(&done()).unwrap()[4..]).unwrap();
    let b = &v["Done"]["blocks"][0];
    assert_eq!(b["kind"], "paragraph");
    assert_eq!(b["method"], "text_layer");
    assert_eq!(b["page"], 1);
    let f = Codec::Json.encode(&FromWorker::Failed { code: FailCode::Unreadable, reason: "x".into() }).unwrap();
    assert!(String::from_utf8_lossy(&f[4..]).contains(r#""code":"unreadable""#));
}

#[test]
fn limits_default_to_sec_04() {
    let l = Limits::default();
    assert_eq!(l.file_bytes, 500_000_000);
    assert_eq!(l.pages, 2000);
    assert_eq!(l.image_megapixels, 100);
    assert_eq!(l.pdf_object_depth, 64);
    assert_eq!(l.page_text_bytes, 1_000_000);
}

#[test]
fn clean_eof_before_a_frame_is_none_but_a_cut_frame_is_an_error() {
    let empty: &[u8] = &[];
    assert!(read_frame::<_, ToWorker>(&mut { empty }, Codec::Json).unwrap().is_none());
    let frame = Codec::Json.encode(&ToWorker::Hello { proto_version: 1 }).unwrap();
    for cut in [1, 3, 4, frame.len() - 1] {
        let e = read_frame::<_, ToWorker>(&mut &frame[..cut], Codec::Json).unwrap_err();
        assert!(matches!(e, FrameError::Truncated), "cut at {cut}: {e:?}");
    }
}

#[test]
fn a_length_over_the_limit_is_refused_before_reading_the_body() {
    assert_eq!(body_len((MAX_FRAME_BYTES as u32).to_le_bytes()).unwrap(), MAX_FRAME_BYTES);
    let over = (MAX_FRAME_BYTES as u32 + 1).to_le_bytes();
    assert!(matches!(body_len(over), Err(FrameError::TooLarge(n)) if n == MAX_FRAME_BYTES + 1));
    let mut input = over.to_vec();
    input.extend_from_slice(b"{}");
    assert!(matches!(read_frame::<_, ToWorker>(&mut input.as_slice(), Codec::Json), Err(FrameError::TooLarge(_))));
}

#[test]
fn an_oversized_message_is_not_encoded() {
    let big = FromWorker::Failed { code: FailCode::Limit, reason: "x".repeat(MAX_FRAME_BYTES) };
    assert!(matches!(Codec::Postcard.encode(&big), Err(FrameError::TooLarge(n)) if n > MAX_FRAME_BYTES));
    let fits = FromWorker::Failed { code: FailCode::Limit, reason: "x".repeat(MAX_FRAME_BYTES - 16) };
    assert!(Codec::Postcard.encode(&fits).is_ok());
}

#[test]
fn a_body_of_the_wrong_shape_is_malformed() {
    let mut input = 2u32.to_le_bytes().to_vec();
    input.extend_from_slice(b"{}");
    assert!(matches!(read_frame::<_, ToWorker>(&mut input.as_slice(), Codec::Json), Err(FrameError::Malformed(_))));
    assert!(matches!(Codec::Postcard.decode::<FromWorker>(&[200, 1]), Err(FrameError::Malformed(_))));
}
