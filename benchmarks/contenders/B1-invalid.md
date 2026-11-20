# Contender B1 — attempt 1 (INVALID: environment failure)

The DB lost its tables mid-run (profiles table did not exist when checked
post-run) and the app server died at ~11:13 IST, 6+ minutes before the
subagent gave up. The login failure the subagent reported (401 for every
credential, including the correct ones) was environmental, not a bug in the
stripped copy — verified by resetting the DB and confirming login works.

The subagent's PUBLIC findings (search punctuation crash, newsletter native
GET, promo 404, ✦ dead button, recommendations slow) were against the
working part of the app and are genuine, but 5/7 of the app (all
auth-gated pages) was untestable. The run does not count.

Raw subagent output preserved in the commit alongside this note.
