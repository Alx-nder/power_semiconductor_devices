# Systematic Simulation Plan

## Current Status (April 15, 2026)

### Completed
- (none — Si switching logs were invalid, need re-run)

### Pending
- All 9 Si switching decks (re-run — old logs had no transient output)
- All 9 Si steady-state decks
- All 18 WBG steady-state decks
- All 18 WBG switching decks

## Execution Plan

### Phase 0: Cleanup — Delete Bad Si Switching Logs
- Old Si switching runs only produced Pass 1 (DC forward) output
- No `_rr_tr.log` transient files were generated
- Delete all 9 `switching.log` files to enable re-run

### Phase 1: Silicon Switching RE-RUN (9 decks — fastest material)
Priority: Si is fastest; switching needs validation first
```
si_pin_10v/switching.in      si_pin_100v/switching.in      si_pin_1200v/switching.in
si_schottky_10v/switching.in  si_schottky_100v/switching.in  si_schottky_1200v/switching.in
si_mosfet_10v/switching.in    si_mosfet_100v/switching.in    si_mosfet_1200v/switching.in
```

### Phase 2: Silicon Steady State (9 decks)
```
si_pin_10v/steady.in      si_pin_100v/steady.in      si_pin_1200v/steady.in
si_schottky_10v/steady.in  si_schottky_100v/steady.in  si_schottky_1200v/steady.in
si_mosfet_10v/steady.in    si_mosfet_100v/steady.in    si_mosfet_1200v/steady.in
```

### Phase 3: 100V WBG Steady State — PIN then MOSFET (4 decks)
```
sic_pin_100v/steady.in     gan_pin_100v/steady.in
sic_mosfet_100v/steady.in  gan_mosfet_100v/steady.in
```

### Phase 4: Remaining WBG Steady State (14 decks)
- SiC + GaN: 10V, 1200V for all families; 100V Schottky

### Phase 5: All WBG Switching (18 decks)
- SiC + GaN switching with proper reverse recovery circuit

## Execution

Run with:
```bash
./run_systematic.sh
```

Monitor progress:
```bash
tail -f run_systematic.log
```

## Script Features
- Skips already-completed decks (checks for existing .log files)
- Sequential execution (1 license token)
- Automatic phase progression
- Summary statistics at end
- Failed deck tracking
