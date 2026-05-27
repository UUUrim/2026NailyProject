# Nail ArUco — Custom Nail Tip STL Generator

Measure real fingernails from photos using an ArUco marker for scale, then generate 3D-printable STL nail tips sized exactly to those measurements.

---

## Project Flow

```
1. Take photos  →  2. Crop  →  3. Measure  →  4. Generate STL
```

### Step 1 — Take photos

Each finger is photographed individually (one photo per finger).

**Photo requirements:**
- Finger pointing **up**, palm facing camera
- **Dark background** (navy, black, dark green) — required for segmentation
- **ArUco marker** placed flat beside the finger in the same plane
- Camera directly above, ~30–40 cm distance
- Even lighting, no harsh shadows

Generate and print the ArUco marker once:
```bash
python generate_aruco.py --size 20 --id 0 --output marker.png
```
Print at 100% scale (no "fit to page"). Measure the inner black square with calipers and note the exact mm value.

---

### Step 2–4 — Run the full pipeline (recommended)

```bash
python run_pipeline.py \
    --photos photos/thumb.jpg photos/index.jpg photos/middle.jpg \
             photos/ring.jpg  photos/pinky.jpg
```

This runs all three steps automatically for all 5 fingers:
1. **Crop** — removes the bottom 30% of each photo (box edge, red fabric, etc.)
2. **Measure** — detects the ArUco marker, segments the finger, and measures the nail
3. **Generate STL** — produces a `round` nail tip STL for each finger

**Optional flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--aruco-size` | `20` | Physical ArUco marker side length in mm |
| `--crop-fraction` | `0.30` | Fraction of image height to remove from bottom |
| `--output` | `results/` | Root output folder |

**Output per finger** (saved to `results/{finger}/`):
- `nail_measurements.json` — all measurements + mesh parameters
- `profile.json` — nail size classification + skin tone
- `{finger}_annotated.jpg` — photo with nail outline and measurements overlaid
- `stl/nail_{finger}_round.stl` — 3D-printable nail tip

---

### Running steps individually

#### Step 2 — Crop

The crop step removes the bottom portion of the photo to isolate the navy background, marker, and finger. It is handled automatically by `run_pipeline.py`, but can also be run manually via `crop_and_measure.py`.

#### Step 3 — Measure

```bash
# Single finger
python nail_measurer.py --top index_cropped.jpg --finger index --aruco-size 20 --output results/index

# All fingers at once (batch)
python nail_measurer.py --batch \
    --fingers thumb index middle ring pinky \
    --tops    thumb_cropped.jpg index_cropped.jpg middle_cropped.jpg ring_cropped.jpg pinky_cropped.jpg \
    --aruco-size 20 --output results/
```

**What gets measured:**

| Field | Description |
|-------|-------------|
| `width_mm` | Widest point across the nail plate |
| `length_mm` | Tip to cuticle |
| `corrected_length_mm` | Length corrected by W/L ratio (Jung et al. 2015) |
| `c_curve_mm` | Arc depth (sagitta) — how much the nail curves across its width |
| `arc_radius_mm` | Radius of curvature: R = w²/(8h) + h/2 |
| `thickness_mm` | Estimated from c-curve (geometric estimate) |
| `skin_tone_hex` | Median skin colour sampled around the nail |

#### Step 4 — Generate STL

```bash
python nail_exact_stl.py --input results/index/nail_measurements.json \
    --shape round --finger index --output results/index/stl/

# Available shapes: round | almond | square | stiletto | ballerina
```

**Available tip shapes:**

| Shape | Description |
|-------|-------------|
| `round` | Semi-ellipse, smooth closed arc |
| `almond` | Cosine taper to a soft point |
| `square` | Full width, flat perpendicular tip |
| `stiletto` | Long linear taper to a sharp point |
| `ballerina` | Linear taper to a flat narrow tip (coffin-like) |

---

## Files

| File | Purpose |
|------|---------|
| `run_pipeline.py` | **Full pipeline** — crop → measure → STL for all 5 fingers |
| `generate_aruco.py` | Generate the ArUco marker PNG to print |
| `nail_measurer.py` | Step 3 — Measure nails from cropped photos; outputs JSON + annotated images |
| `nail_exact_stl.py` | Step 4 — Generate parametric STL from measurements |
| `crop_and_measure.py` | Single-finger crop + measure + STL (manual use) |
| `manual_selector.py` | Fallback — manually trace the nail outline when auto-detection fails |
| `nail_shape_stl.py` | Alternative STL generator built from the actual traced nail polygon |
| `nail_tip_generator.py` | Older STL generator — supports C-curve presets (flat/medium/steep) |

---

## Results folder structure

```
results/
  {finger}/
    nail_measurements.json   ← measurements for this finger
    profile.json             ← size classification + skin tone
    {finger}_annotated.jpg   ← annotated photo
    stl/
      nail_{finger}_{shape}.stl
```

> `results/` is listed in `.gitignore` and is not tracked by git.

---

## Install

```bash
pip install opencv-python opencv-contrib-python numpy scipy
```
Python 3.10+ recommended.
