# Bush Pilot

A keyboard-only, side-view bush flying game for the browser. You fly freight from
Raven Creek Base eastward over Alaska/Yukon-style terrain to remote gravel strips,
get paid on delivery, and spend the cash on upgrades and bigger aircraft.

## Run it

Open `index.html` in any modern browser. No build step, no dependencies, no server
needed (everything is plain ES5 JavaScript on a `<canvas>`). Progress is saved in
`localStorage`.

## Controls

| Key | Action |
|-----|--------|
| `↑` / `↓` (or `W` / `S`) | Elevator: nose up / nose down |
| `SPACE` (or `T`) | Throttle on / off (full power or idle, nothing in between) |
| `ENTER` | Select |
| `ESC` | Back; pause in flight (resume or abandon the mission) |
| `←` / `→` | Adjust fuel load in the briefing |
| `M` | Sound on / off |

The hangar menu has a toggle to invert the pitch axis if you prefer "pull back = up".

## How a flight works

1. **Job board** – four jobs are posted at a time. Each lists destination, distance,
   strip length and elevation, the highest terrain on the route, cargo weight and pay.
   Pay scales with distance, weight and how high the ridges are.
2. **Briefing** – pick the fuel load. Fuel costs money and weighs 0.72 kg/L, so a
   full tank on a short hop just makes the plane heavier. The briefing shows takeoff
   weight, stall speed at that weight (also at ridge altitude) and endurance.
3. **Takeoff** – throttle on, hold `↑` to rotate at about 70 km/h (Cub), ease off
   once airborne and climb at roughly 90 km/h. You always take off eastward and you
   cannot turn around, so plan the climb early: the air thins with altitude and the
   high passes may be out of reach for a heavy Cub.
4. **Landing** – the HUD and the route minimap show the strip; a green marker shows
   the threshold. Throttle off is also the brakes. Touch down softer than the gear
   limit, slower than the structural limit, nose not below the ground, and roll to a
   full stop on the gravel. A touchdown under 1 m/s earns a 10 % greaser bonus;
   a hard one damages cargo (-20 %).

Crashing costs repairs (5 % of plane value + $200) and the cargo. Running out of
fuel and stopping anywhere else costs a recovery fee. Landing on an intermediate
strip is allowed; you can take off again.

## Simulation notes

* `js/physics.js` – point-mass flight model in SI units: lift/drag from angle of
  attack with a stall curve, prop thrust `P·η / v` with a static cap, air density
  `ρ0·exp(-h/5000)` (exaggerated scale height so altitude bites), mass =
  empty + pilot + fuel + cargo, ground roll with brakes and a tail-dragger pitch
  clamp, landing/crash rules. Simulation runs at 2.5× real time.
* `js/world.js` – deterministic procedural terrain (value-noise fbm plus one
  designed ridge between each pair of strips), flattened airstrips with gentle
  departure/approach ramps, lakes in valley floors, tree line and snow line,
  spruce placement and cloud layer.
* `js/render.js` – canvas drawing: altitude-tinted sky, parallax ranges, terrain
  with snow/rock/tundra/forest bands, lakes, trees, strips with cabins and
  windsocks, aircraft sprite drawn from primitives, HUD and route minimap.
* `js/audio.js` – procedural WebAudio engine/wind/stall horn.
* `js/game.js` – state machine (title → hangar → jobs → briefing → flight →
  result), economy, upgrades, save/load, input, main loop.

## Aircraft and upgrades

| Aircraft | Price | Notes |
|----------|-------|-------|
| Piper J-3 Cub | starting plane | 65 hp, 45 L, ~100 kg comfortable payload |
| Piper PA-18 Super Cub | $7,500 | 150 hp, 136 L, ~280 kg |
| DHC-2 Beaver | $32,000 | 450 hp, 360 L, ~850 kg |

Upgrades (per aircraft): engine tune, climb propeller, STOL kit, heavy-duty gear,
long-range tanks, lightweight build. Add a new aircraft by appending an entry to
`Physics.PLANES`; everything else (missions, shop, sprite scaling) picks it up.

## Destinations

Moose Flats (3.8 km), Caribou Lake Lodge, Ptarmigan Mine (a short strip on a
720 m bench), Glacier Camp, Tanana Crossing, Kluane Outpost and Yukon Bar
(33.8 km, over a ~1,350 m ridge). Ridges grow from about 200 m to 1,350 m going
east; a lightly loaded Cub can clear all of them if it starts climbing immediately,
but the far strips need a steep, well-planned descent.
