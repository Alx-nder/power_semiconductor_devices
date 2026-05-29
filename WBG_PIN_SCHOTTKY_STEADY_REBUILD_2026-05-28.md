# WBG PiN / Schottky Steady Rebuild - 2026-05-28

Scope: GaN and 4H-SiC matrix PiN and Schottky steady-state I-V decks only.

Requested normalization:
- Lateral x-span reduced to 2 um for uniform-in-x devices.
- `SIMFLAGS` forced to `-P 8 -160` for all GaN and 4H-SiC steady decks in scope.
- `MESH WIDTH=5e+07` to preserve 1 cm^2 active area with 2 um x-span.
- `X.MESH` and `Y.MESH` normalized to 0.1 um spacing everywhere.
- All doping statements converted to Gaussian form.
- `METHOD` reduced to `NEWTON GUMMEL` only.
- Reverse sweep uses `vstep=-1.000` throughout.
- Switching decks are intentionally excluded from this pass.

Validation notes:
- `sic_pin_600v` steady rebuild parses cleanly, writes mesh/structure, and advances through forward bias points under the new template.
- `gan_schottky_600v` steady rebuild parses cleanly, writes mesh, and enters the steady solve under the split-region Schottky template.
- Detached single-license queue launched with PID file `wbg_pin_schottky_steady_single_license_2026-05-28.pid` and log `wbg_pin_schottky_steady_single_license_2026-05-28.nohup.out`.
- Initial queue stopped after 7 decks because the runner did not guard the final unterminated list line; runner updated to consume the last line robustly.

Deck checklist:

| Device | Deck | Edited | Probe | Queue status |
|---|---|---:|---|---|
| SiC PiN 600 V | `devices/matrix/sic_pin_600v/decks/steady.in` | yes | parse/init/solve started | running |
| SiC PiN 1200 V | `devices/matrix/sic_pin_1200v/decks/steady.in` | yes | pending queue | queued |
| SiC Schottky 600 V | `devices/matrix/sic_schottky_600v/decks/steady.in` | yes | pending queue | queued |
| SiC Schottky 1200 V | `devices/matrix/sic_schottky_1200v/decks/steady.in` | yes | pending queue | queued |
| GaN PiN 600 V | `devices/matrix/gan_pin_600v/decks/steady.in` | yes | pending queue | queued |
| GaN PiN 1200 V | `devices/matrix/gan_pin_1200v/decks/steady.in` | yes | pending queue | queued |
| GaN Schottky 600 V | `devices/matrix/gan_schottky_600v/decks/steady.in` | yes | parse/init/solve started | queued |
| GaN Schottky 1200 V | `devices/matrix/gan_schottky_1200v/decks/steady.in` | yes | pending queue | queued |

Queue:
- Deck list: `WBG_PIN_SCHOTTKY_STEADY_DECKS_2026-05-28.txt`
- Remaining deck list: `WBG_PIN_SCHOTTKY_STEADY_REMAINING_2026-05-28.txt`
- Runner: `run_wbg_pin_schottky_steady_single_license.sh`
- Launch mode: detached `nohup`, single-license serialized execution only.