# Brief for Claude: disk cleanup and storage moves (from Josh, via Muse, 2026-11-21)

Context: the MacBook Air internal disk is full enough that macOS cannot install updates. Muse already removed about 11.4 GB of dead weight on 2026-11-21 (stale ELO upload chunks, 44 old release DMGs 0.1.0 to 0.19.0, stale updater caches, CapCut cache). The items below need code or app changes, so they are yours. Josh's words: get on board with everything, and clean up or move your own space too.

## 1. ELO backups: store in Google Drive, with retention
ELO writes daily backups to ~/ELO/Backups (a library zip of about 49 MB plus a database zip daily, about 65 MB per day, no pruning). Muse copied the full existing set to Google Drive, folder "ELO Backups" in My Drive (account sapper13je@gmail.com), local path:
/Users/jeverett/Library/CloudStorage/GoogleDrive-sapper13je@gmail.com/My Drive/ELO Backups
The copy was verified file by file (32 entries, sizes identical) and the local ~/ELO/Backups folder was removed. Until this change lands, ELO will recreate the local folder at the next backup run; that is expected.
Change: point the backup destination at the Drive folder above, and add retention: keep the newest 7 library backups and the newest 7 database backups, prune older ones. Verify a fresh backup lands in Drive and opens.

## 2. Movies data root: stop duplicating the archive locally
~/Movies/Expect Less Output holds ELO's per-channel Inbox, Queue, Posted and Replaced folders. The Posted and Replaced archives duplicate what already lives in Google Drive under EXPECT LESS PRODUCTION (5 POSTED). The 50 largest local files alone are about 2.8 GB.
Change: once a file's Drive copy is verified, do not keep a second local copy in Posted or Replaced (or move that archive tier to Drive outright). Queue and Inbox stay local and untouched; live drops land there. Report how much local space this saves per week.

## 3. Your own footprint: the Claude VM bundle
~/Library/Application Support/Claude/vm_bundles/claudevm.bundle holds rootfs.img at 10.7 GB plus rootfs.img.zst at 1.26 GB. Clean up or move your own space: delete the expanded image if it can be re-extracted from the .zst when needed, relocate the bundle off the internal disk, or shrink it. Report what you did and how much space came back.

## 4. Release hygiene
Muse removed 44 old installer DMGs (0.1.0 through 0.19.0, about 7.3 GB) from release/ on 2026-11-21, keeping 0.20.0. Add a release step that prunes old DMGs and stale app bundles automatically: keep the latest build plus the previous one, remove the rest.

## Report back
When each item lands, report what changed, how you verified it, and the space recovered. Items 1 and 3 matter most: backups growing on the internal disk, and the 12 GB VM bundle, are the two structural drains.
