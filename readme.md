# Nail ArUco — Custom Nail Tip STL Generator

Measure real fingernails from photos using an ArUco marker for scale, then generate 3D-printable STL nail tips sized exactly to those measurements.

---

## Project Flow

```
1. Take a photo  →  2. Measure nail  →  3. Generate STL
```

### Step 1 — Take a photo

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

### Step 2 — Measure the nail

```bash
# Single finger
python nail_measurer.py --top index1.jpg --finger index --aruco-size 20 --output results/index

# All fingers at once (batch)
python nail_measurer.py --batch \
    --fingers thumb index middle ring pinky \
    --tops    thumb.jpg index.jpg middle.jpg ring.jpg pinky.jpg \
    --aruco-size 20 --output results/
```

**Output per finger:**
- `nail_measurements.json` — all measurements + mesh parameters
- `profile.json` — nail size classification + skin tone
- `{finger}_annotated.jpg` — photo with nail outline and measurements overlaid

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

---

### Step 3 — Generate STL

```bash
python nail_exact_stl.py --input results/index/nail_measurements.json \
    --shape round --output results/index/stl/

# Available shapes: round | almond | square | stiletto | ballerina
# Optional flags:
#   --finger index          only generate one finger
#   --thickness 2.0         shell thickness in mm (default 2.0)
#   --tip-extension 5.0     extra mm beyond natural nail tip
#   --cuticle-depth 1.5     depth of cuticle arch in mm
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
| `generate_aruco.py` | Generate the ArUco marker PNG to print |
| `nail_measurer.py` | **Step 2** — Measure nails from photos; outputs JSON + annotated images |
| `manual_selector.py` | Fallback for Step 2 — manually trace the nail outline when auto-detection fails |
| `nail_exact_stl.py` | **Step 3** — Generate parametric STL from measurements (primary generator) |
| `nail_shape_stl.py` | Alternative Step 3 — STL built from the actual traced nail polygon |
| `nail_tip_generator.py` | Older Step 3 generator — supports C-curve presets (flat/medium/steep) |

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

---

## Install

```bash
pip install opencv-python opencv-contrib-python numpy scipy
```
Python 3.10+ recommended.
