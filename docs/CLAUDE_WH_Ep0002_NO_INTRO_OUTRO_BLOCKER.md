# Claude — URGENT: Wonder Hollow Fri 7:00 AM ET post 62 needs media swap

**Slot:** Fri Oct 23, **7:00 AM ET**  
**Post 62** `wonder-hollow-workshop-2026-0002` — status `in_progress`, YouTube `handed_off` → https://youtube.com/shorts/7gnk0Zc2GLM  
B.E.T.H. cannot cancel or `POST /v1/posts/62/media` (both 409).

## HOLD CLEARED (~6:40 AM ET) — use THIS file

- Desktop: `/Users/jeverett/Desktop/BETH_REVIEW_2026-10-22/WonderHollow_Ep0002_AcornBoats_USVOICE_NO_IO_v2_720p.mp4`
- Shared: `/Users/jeverett/Movies/Expect Less Output/Shared/wonder-hollow-workshop-2026-0002_usvoice_no-io_v2.mp4`
- SHA-256 (transfer encode ~67MB): `d8ed57f5a1f01e5f07e0bc71143773ca592f44676e65ff4e1dd85533323b50f2`
- Canonical box master (269MB): `/workspace/wonder-hollow/ep0002/ep0002_review_v3_usvoice_no-io_v2.mp4`
- Canonical SHA: `67c78a73f356ac9669790ed021ec0d5330cb92ecfa8d6afa462051e4ddca66b1`
- Runtime **290.700s** (~4:50.7), 1280×720, **no intro/outro**, **no TTS**

## QC cleared by Render and Edit
- **Ear s23–s44:** LEAVE — false-positive (US rhotic R; timbre change only). Josh’s “second half fine” stands. No regen of s23+.
- **Owl ghost ~4:30:** FIXED — removed `xfade (41,42):0.4` → hard cut. Verified solid owl → solid hollow.
- Report: box `/workspace/wonder-hollow/ep0002/REPORT_USVOICE_REGEN.md`

## What’s fixed vs what’s live on YouTube
Live on post 62: ~316s with **intro+outro** AND **UK accents** in first half.  
Ready file: **no intro/outro**, **US Vocal DNA** on s01–s22, original s23–s44, **owl ghost fixed**.

## Ask Claude
1. Unstick YouTube handoff / take post out of `in_progress` (owner path), **or** replace the YouTube asset directly.
2. Then `POST /v1/posts/62/media` with the **Shared v2** path above (keeps 7 AM slot), **or** cancel + re-drop.
3. Do **not** leave the UK+intro cut live for Friday.
4. Prefer `…_usvoice_no-io_v2.mp4` over the older `…_usvoice_no-io.mp4` (pre–owl-fix).

Josh is asleep — only wake him for real blockers you can’t fix.
