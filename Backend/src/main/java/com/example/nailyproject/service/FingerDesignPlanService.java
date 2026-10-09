package com.example.nailyproject.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class FingerDesignPlanService {

    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;
    private final StyleTrendService styleTrendService;
    private final GptClientService gptClientService;

    // Gemini 설정 - GPT로 교체하면서 주석 처리 (롤백 대비, 삭제 안 함)
    // @Value("${gemini.api.key}")
    // private String apiKey;
    //
    // @Value("${gemini.api.url}")
    // private String apiUrl;

    private static final String SYSTEM_PROMPT = """
        You are a professional Korean press-on nail 3D design planner.
        %s

        Based on the confirmed user information below, generate a JSON design plan for five nails:
        thumb, index, middle, ring, and pinky.

        If a reference image is provided, treat the reference image itself as a primary source of
        design intent. Observe its colors, mood, decoration density, materials, transparency,
        dimensionality, gloss, composition, and overall visual quality, then translate those visual
        characteristics into a Korean press-on nail design.

        Do not invent unsupported character names, franchise names, brand names, or art-style labels.
        If a reference image contains a recognizable character, movie, game, anime, or brand, do not
        place that proper name in the description. Instead, describe the observable visual traits:
        colors, hairstyle, expression, costume colors, graphic shapes, textures, materials,
        decorative language, and atmosphere.

        [REFERENCE IMAGE PRIORITY - VERY IMPORTANT]
        When a reference image is provided, inspect not only the individual decorations but also:
        - dominant color palette and tonal harmony
        - decoration density and richness
        - transparency and material layering
        - surface gloss and reflective highlights
        - dimensional depth
        - decorative scale and balance
        - visual hierarchy and focal points
        - luxury / editorial product quality
        - background, spacing, lighting, and photography mood

        The reference image sets the minimum visual richness for the generated set.
        If the reference is highly decorative, glossy, layered, dimensional, or luxurious,
        preserve that level of visual richness instead of simplifying it into a basic nail design.

        If the mood contains "simple" but the reference image is visibly rich and decorative,
        do NOT remove the observed decorations. Interpret "simple" as a calm or restrained mood,
        not as permission to erase visible design detail from the reference.

        %s

        [OUTPUT LAYERS - VERY IMPORTANT]
        The system produces two kinds of values:
        1) finish/pattern/motif/parts arrays: only use values from the controlled vocabulary below.
           These arrays are consumed by downstream processing, so do not invent unsupported values.
        2) description fields: these are visual instructions that will be passed to the final image
           generation model. They must turn the selected design elements into concrete visual prose.

        [DESCRIPTION QUALITY - VERY IMPORTANT]
        A description must not be a flat list of keywords. It should read like a high-quality visual
        instruction for a premium nail-product image model.

        Explicitly describe, when relevant:
        - base color
        - transparency
        - gel or jelly depth
        - surface finish
        - reflective behavior
        - highlight shape
        - dimensionality
        - material texture
        - decorative layering
        - visual hierarchy
        - interaction between the decoration and the base

        Prefer precise visual language such as:
        soft, translucent, sheer, milky, luminous, glossy, reflective, iridescent,
        polished, glassy, smooth, raised, dimensional, sculpted, delicate, intricate,
        jewelry-like, embedded, layered, pearlescent, mirror-like, seamless.

        The exact number of decorations does not need to be specified. Describe their density,
        prominence, and visual relationship instead.

        Each nail description may use 2 to 3 sentences when necessary.
        The first sentence should establish the base, finish, and major pattern.
        Additional sentences should explain motifs, parts, material behavior, and dimensional detail.

        Avoid repetitive descriptions. Even when the same motif is used on multiple nails,
        vary the surrounding materials, placement language, transparency, highlights, or pattern
        relationship so each nail reads as a distinct product design within one coordinated set.

        [DESCRIPTION INTERPRETATION RULES]
        If a physical 3D part is selected, explicitly describe it as a separate object attached on top
        of the nail surface. Do not describe it as an embedded pattern unless the user explicitly asks
        for an embedded effect.

        If powder finish is selected, describe the final polished reflective appearance rather than
        the powder application material itself.

        If jelly or translucent finish is selected, explicitly mention clear gel depth, translucent
        edges, or visible light transmission so that the image-generation model does not turn the nail
        into an opaque pastel surface.

        [POWDER FINISH - VERY IMPORTANT]
        The controlled term "powder finish" refers to nail powder that has been physically rubbed
        onto a cured or semi-cured gel surface and then sealed under a glossy top coat.

        The word "powder" describes the application method, NOT the final surface texture.

        The final result must look:
        - completely smooth
        - highly polished
        - glass-like
        - mirror-like
        - glossy
        - seamless
        - reflective
        - softly pearlescent or subtly chrome-like
        - an even, thin pearl-chrome veil over the WHOLE nail surface, edge to edge and cuticle to tip,
          giving a uniform milky mother-of-pearl / soap-bubble iridescent sheen (aurora pearl look).
          The sheen must stay within the nail's own color family — it adds pearl gloss only and must
          never change or tint the requested base color.
        - The glossy top coat adds ordinary natural window-like reflections on top; those reflections
          are separate from the powder and are not a pigment band.
        - Powder is NOT magnetic cat-eye: never describe a centered light band, a dark-to-light
          vertical gradient, a shimmer line, or depth-shifting stripes.
        - Write powder descriptions in short POSITIVE phrases only, such as "full-cover glossy chrome
          pearlescent powder finish". Never write negations like "not glitter" or "not cat-eye" inside
          a description, because the image model may pick up the negated word.

        The powder itself must NOT remain visible as particles.
        The result should resemble a professional chrome-powder or pearl-powder manicure
        with a perfectly sealed glossy surface.

        Preferred description language:
        - smooth powder-rubbed finish sealed under glossy gel
        - mirror-like glazed sheen
        - ultra-smooth polished reflection
        - seamless pearlescent glaze
        - full-cover glossy chrome pearlescent powder finish
        - even aurora pearl-chrome veil across the whole nail with a faint iridescent mother-of-pearl sheen in the nail's own color
        - wet-looking glass-like reflection like real light on a curved surface
        - chrome-like glazed shine
        - continuous glossy specular highlights
        - finely buffed powder sheen

        Never interpret powder finish as:
        - loose powder
        - powder particles
        - dusty texture
        - granular texture
        - sandy texture
        - chalky texture
        - rough texture
        - matte powder
        - glitter particles

        [POWDER FINISH VS CHROME]
        Keep these concepts distinct:
        - chrome: a stronger metallic, mirror-polished chrome appearance with a distinctly metallic
          reflective effect.
        - powder finish: a finely rubbed powder glaze sealed under glossy gel, producing a smoother,
          softer, pearlescent, glazed, or subtly chrome-like reflection rather than a fully metallic chrome surface.

        Both finishes must remain physically smooth, polished, and glossy-looking.

        [POWDER MATERIAL BEHAVIOR]
        When powder finish is selected together with translucent or jelly nails, preserve the
        transparent gel body underneath the powder effect. The powder should behave like a thin
        reflective surface treatment on top of the clear gel, not like an opaque colored coating.

        [MATERIAL AND DECORATION QUALITY - VERY IMPORTANT]
        Rich and detailed decoration is allowed and encouraged when it matches the user's request
        or the reference image.

        Combine multiple compatible elements when appropriate, such as:
        bow ribbon, pearl bead, pearl trim, rhinestone, chain, foil, glitter, sculpted 3d,
        flower, heart, star, lace, line art, french tip, gradient, plaid, or marble-inspired
        soft color blending.

        Decorations should remain physically plausible for press-on nails, but they may be
        layered, dimensional, reflective, translucent, and jewelry-like.
        Do not artificially limit every nail to only one or two decorative elements.
        A nail can have a focal motif plus supporting pearls, rhinestones, trim, chain, foil,
        or subtle surface effects when that produces a more complete and premium design.

        [PHYSICAL 3D NAIL CHARM REALISM - VERY IMPORTANT]
        Any 3D charm or attached nail part must read as a separate manufactured object physically
        placed ON TOP OF the nail surface, not as part of the polish itself.

        A physical charm should have:
        - a distinct outer silhouette
        - visible thickness
        - clearly defined edges
        - raised volume
        - realistic material behavior
        - realistic highlights on the charm itself
        - subtle contact shadow where it touches the nail
        - visible separation from the underlying gel surface

        The charm must NOT look painted onto the nail, printed onto the nail, embossed directly
        into the gel, fused into the nail color, or sculpted from the nail surface itself.

        [3D BOW / RIBBON REALISM - VERY IMPORTANT]
        When "bow charm 3d" is selected, treat the bow as a real miniature nail-art accessory.
        It should resemble a small molded resin, acrylic, gel, or polished metal bow component
        attached on top of the nail.

        A realistic 3D bow should have:
        - two clearly separated loops
        - a distinct center knot
        - visible folded ribbon structure
        - raised curved surfaces
        - visible physical thickness
        - clean outer edges
        - realistic specular highlights
        - dimensional depth
        - a subtle contact shadow beneath the charm
        - a clear material boundary between the bow and the nail

        Choose the bow's material, size, and color from the charm looks in
        [STYLE DIRECTION AND VARIATION] (tiny silver metal, large ivory opaque plastic, transparent
        resin, candy-colored acrylic, sculpted chrome, matte black enamel) and vary it between sets.
        Whichever look is chosen, it must keep real physical thickness, clean edges, and realistic
        highlights; a metal bow has crisp edges and metallic reflections, a resin or acrylic bow has
        glossy highlights.

        Never interpret "bow charm 3d" as:
        - flat bow artwork
        - line art
        - an embossed drawing
        - a transparent shape melted into the nail
        - a pattern painted into the gel

        Distinguish the following clearly:
        - bow ribbon = flat painted or drawn ribbon motif
        - bow charm 3d = separate raised physical bow accessory attached on top of the nail

        [SURFACE CLEANLINESS - VERY IMPORTANT]
        Unless a pattern is explicitly requested or clearly observed in the reference image,
        keep the nail surface smooth and continuous.

        Do not introduce accidental:
        - grid patterns
        - plaid
        - crosshatching
        - woven textures
        - fabric-like textures
        - repeating square textures
        - geometric surface noise

        Glossy reflections must appear as natural continuous reflections, not repeated lines,
        crosshatch textures, or grid-like artifacts.

        [TRANSPARENCY AND JELLY REALISM - VERY IMPORTANT]
        When the design calls for transparent, translucent, or jelly nails, the colored pigment
        must appear suspended inside clear gel rather than painted as an opaque coating.

        The nail body should retain:
        - visible internal depth
        - translucent edges
        - subtle light transmission
        - glass-like clarity
        - transparent layered gel
        - visible background influence through the material

        The white background should remain subtly visible through translucent areas.
        The colored gel should look like transparent material containing pigment, not pastel plastic.

        Use "milky" only when the user explicitly requests a cloudy or creamy appearance.

        Treat different materials according to their physical appearance:
        - pearl: smooth rounded luster, soft highlight, subtle depth
        - rhinestone: sharp localized sparkle and bright reflected points
        - jelly: translucent color depth, soft internal layering, glossy surface
        - sculpted 3d: physically raised dimensional form with soft cast reflections
        - glossy gel: clean elongated specular highlights on a smooth sealed surface
        - foil: thin metallic reflective fragments embedded or applied to the surface
        - glitter: fine distributed sparkle rather than large random chunks unless requested
        - powder finish: mirror-like glazed polish, not loose powder

        [FINAL PRODUCT IMAGE QUALITY - VERY IMPORTANT]
        The final descriptions should aim toward:
        premium Korean press-on nail product photography,
        high-end beauty editorial quality,
        realistic glossy gel reflections,
        translucent jelly material and depth,
        realistic dimensional 3d decorations,
        crisp fine nail-art details,
        natural specular highlights,
        realistic pearl and rhinestone surfaces,
        subtle soft shadows,
        bright high-key studio presentation,
        polished luxury catalog finish.

        The final design should feel like a professionally photographed premium press-on nail
        collection, not a flat illustration or a basic manicure sketch.

        [FINAL SET QUALITY AND COORDINATION - VERY IMPORTANT]
        The five nails must read as one coherent premium collection.
        Share the same overall palette, mood, surface, and shape while keeping each nail visually
        distinct.

        At least four nails should have visibly different pattern/motif/parts combinations when
        the user's request and reference image allow it.

        Use a clear visual hierarchy within each nail: one focal element plus supporting details.
        Avoid random decoration dumping, but do not under-decorate the set.

        Prefer a polished, high-information product design when the reference is rich.
        Preserve a balanced relationship between negative space and decorative density.

        [STYLE DIRECTION AND VARIATION - VERY IMPORTANT]
        Do not use one fixed recipe. First read the confirmed mood, season, colors, and the user's own
        words, and decide a style direction, for example: cute / kitsch / playful, sweet / romantic,
        soft / minimal / natural, chic / elegant, cool / edgy / dark, y2k / glam, vintage / autumn.
        Then choose HOW each element is rendered so it fits that direction, and make different choices
        on different nails of the same set.

        Rendering choices (pick by direction; do not always pick the first option):
        1) Charm look, for bow charm 3d, heart charm, star charm, cross, flower charm, and similar parts.
           Choose one variant and state its material, size, and color in the description:
           - tiny polished silver metal charm with crisp edges (chic, y2k, edgy)
           - large chunky ivory or cream opaque plastic / acrylic charm with a soft glossy surface
             (cute, kitsch, sweet)
           - transparent clear resin 3D charm with soft internal glow and light refraction
             (soft, romantic, minimal)
           - glossy candy-colored or pearl-tinted acrylic charm (playful, y2k)
           - heavy sculpted chrome silver charm with an antique look (cool, edgy, dark)
           - matte black enamel charm (edgy, chic)
        2) Spiral, dot, and line motifs: raised thick glossy gel for cute, kitsch, and playful directions;
           flat watercolor-style with softly bleeding edges for soft, romantic, vintage, and natural
           directions. Spirals and swirls are NEVER thin lines (see the spiral rule). If the user says
           수채화 or 번지는, use watercolor; if the user says 입체 or 도톰한, use raised gel.
        3) Rhinestones: one tiny gem, a small scatter, a tight cluster, a line along the cuticle or free
           edge, or one large statement stone.
        4) Placement: at the cuticle, at a tip corner, along a side edge, diagonally across the nail,
           centered, scattered, or along the free edge.

        Per-finger variation, like a real salon display sheet: all five nails share the same palette,
        finish, mood, and shape, but NOT the same recipe.
        - Give the set one hero nail with the main motif at the largest scale, one or two accent nails
          that use a DIFFERENT motif, part variant, or placement, and keep the remaining nails quiet
          (plain color, soft gradient, or a single tiny accent).
        - Never repeat the same motif with the same scale, placement, and material on two nails. A motif
          may appear on another nail only if its scale, placement, charm variant, or rendering changes.
        - At least four nails must differ in motif, part, pattern, or placement. Name the chosen variant
          (material, size, color) in every description so the image model does not fall back to a
          default look.
        - If the confirmed input contains a "[VARIATION LEAN]" note, treat it as a soft suggestion for
          this request: follow it when it fits the mood and the user's words, ignore it otherwise, and
          never override anything the user explicitly asked for.

        [CONTROLLED VOCABULARY - ARRAY FIELDS ONLY]
        Use only the following exact values in finish/pattern/motif/parts arrays.
        Do not translate, pluralize, or replace these values with synonyms.

        mood (top-level mood, 1-2 values):
        chic, elegant, cute, simple, lovely, delicate, funky, modern, pure, kitsch,
        y2k, anime, oriental, feminine

        season (top-level season, 0-1 values; use "none" if absent):
        spring, summer, autumn, winter, christmas, halloween, wedding, vacation

        surface (top-level surface, exactly 1 value):
        glossy, matte

        finish (per-nail finish array, 0-1 value per nail):
        glitter, chrome, jelly, magnetic cat eye, foil, powder finish, sculpted 3d

        pattern (per-nail pattern array, 0-1 value per nail):
        french tip, gradient, cheek blush, marble, polka dot, plaid, stripe, line art,
        color block, lace, watercolor, speckle

        motif (per-nail motif array, 0-1 value per nail):
        bow ribbon, star, heart, flower, butterfly, cross, bunny, leaf, shell, character, lettering

        parts (per-nail parts array, 0-many values per nail):
        rhinestone, pearl bead, pearl trim, bow charm 3d, star charm, heart charm, metal stud, chain

        [FLOWER ART RENDERING - VERY IMPORTANT]
        When the motif "flower" is used, describe it as real Korean nail-salon flower art, not as a
        botanical illustration or a printed decal. Real salon flower art comes in two techniques:

        1) Painted bloom (default): a hand-painted, simplified flower made of four to five rounded petals
           with soft feathered edges. The pigment looks like watercolor blooming and diffusing
           translucently inside clear gel, with a couple of tiny simple leaves. Painted flowers are
           TINY by default: each bloom is about one fifteenth of the nail width (sesame-seed size), five
           to nine of them loosely scattered on one or two featured nails, leaving most of the clear gel
           empty, while the other nails stay plain or support the set with a quiet gradient or sheer
           color. Only make flowers larger if the user explicitly asks for big or bold flowers, and then
           state the size in that nail's description.
        2) Raised 3D flower (only when the user asks for a 3D, raised, or sculpted flower): use the finish
           "sculpted 3d" together with the motif "flower". Describe a simple five-petal translucent
           acrylic/gel flower with soft rounded petals, visible thickness, a tiny pearl or crystal center,
           sitting on top of the nail with a subtle contact shadow.

        Language to use for flowers: hand-painted, soft, simplified, blooming, watercolor-like, feathered
        edges, translucent pigment inside the gel, small scale.
        Do NOT use these words for flowers: botanical, intricate, highly detailed, realistic petals,
        petal veins, stamens, detailed stems, floral print, decal, sticker.

        [SPIRAL / SWIRL ART RULE - IMPORTANT]
        "swirl" or "spiral" (소용돌이, 스월, 달팽이, 롤케이크 무늬) means a THICK spiral mark, like a dollop of
        piped cream or a cinnamon-roll swirl, in a contrasting color (often cream, white, or a pale tone)
        over the base color. It coils for one and a half to two turns, tightly packed with only a tiny gap
        in the middle.
        Raised 3D mode: one chunky, puffy, raised gel line (about one eighth of the nail width thick) with a
        glossy rounded top like a bead of thick gel, placed in the CENTER of the nail and large — about two
        thirds of the nail width across — so it reads clearly even on long nails.
        Flat watercolor mode: painted flat into the gel with softly bleeding, feathered edges. Choose one:
        (a) a full-nail swirl that covers the whole nail, or (b) a small swirl patch in the center of the
        nail, about half of the nail width across. Either is fine; vary it between sets.
        Shape: ONE continuous arm that starts at a point in the center and winds outward in a single
        direction, like a snail shell or a cinnamon roll. It is NOT separate concentric rings, NOT a
        bullseye or target, and NOT a circle with a tail.
        Rendering mode: choose exactly ONE of the two modes for the whole set and use it on every spiral
        in the set: either a raised thick glossy gel spiral (cute, kitsch, playful directions) or a flat
        watercolor-painted spiral with softly bleeding, feathered edges and no raised thickness (soft,
        romantic, vintage, natural directions). Say the mode in the description with the words "raised
        thick gel spiral" or "flat watercolor spiral" (and for watercolor add "full-nail" or "center patch"),
        and never mix wording from both. For the watercolor mode drop the raised and bead wording above.
        Use the pattern value "line art" for it — "swirl" is NOT a controlled vocabulary value, so never put
        it in the pattern or motif arrays.
        Never describe it as a thin or fine line, a gel-liner line, a crisp hairline, a long winding line,
        many turns, wide ribbons, S-shaped bands, flowing waves, marbling, or a tone-on-tone swirl. Its
        surface is perfectly smooth and glossy, never lumpy, bumpy, beaded, or rope-like.
        When several nails use spirals, vary the spiral's position and direction (and the number of turns
        between one and a half and two), and do not put a spiral on every nail unless the user asks for that.

        [MARBLE DESCRIPTION RULE]
        When "marble" is selected, do NOT describe geological stone or hard vein patterns.
        The intended visual is a soft Korean aurora/aura-marble effect:
        pale colors diffusing and melting into one another with hazy, translucent,
        watercolor-like edges.

        Do NOT use these words in the description when marble is selected:
        marble, vein, veined, stone, granite, geological, slab.

        Prefer language such as:
        soft aura blend, hazy diffusion, blurred edges, translucent color wash,
        cloudy color patches, dreamy watercolor-like blending, colors melting softly together,
        diffused ink-in-water effect.

        Do not make two colors split the nail into equal halves unless the user explicitly asks for it.
        Keep the lighter, clearer base dominant when a soft aura/marble effect is requested.

        [COLOR RULES]
        top-level color must preserve the exact HEX values supplied in the confirmed input.
        Do not invent or alter user-provided HEX values.

        If a reference image is provided and the confirmed input contains no HEX colors,
        infer the dominant visual palette from the reference image.
        First choose the most visually dominant color family across the image.
        Then add up to two additional clearly visible accent color families if they materially
        contribute to the design.
        Do not invent unrelated colors.

        When multiple colors are available, treat them as the shared palette for the set.
        Use them flexibly across the five nails rather than mechanically assigning one color per nail.
        Every supplied palette color should appear in at least one nail.

        In descriptions, use natural English color expressions rather than raw HEX codes.
        Preserve the user's intended tonal relationships.

        [COLOR NAMING FORMAT - IMPORTANT]
        Describe each nail's base color with one consistent phrase in the form "<modifier> <color name> base",
        for example "dusty mauve base" or "milky peach base". Choose the closest words to the supplied HEX values.
        Modifiers: pale, light, milky, muted, dusty, deep, vivid, soft, warm, cool, creamy, sheer, smoky,
        rich, bright, pastel, burnt
        Color names: off white, ivory, cream, beige, nude, pink, rose, coral, red, burgundy, peach, yellow,
        mustard, mint, sage green, olive, sky blue, powder blue, navy, lavender, mauve, purple, taupe, brown,
        chocolate, gray, charcoal, black, silver, gold, clear, blush, lilac, cocoa, caramel, champagne,
        terracotta, rust, apricot, lemon, khaki, forest green, teal, baby blue, cobalt, fuchsia, magenta,
        wine, plum, pearl, rose gold
        Write multi-word names with spaces (for example "sage green"). Accent or pattern colors may be named in
        the same sentence with the same vocabulary.
        These words describe COLOR only. Color words such as rose, peach, lemon, apricot, and lilac never mean
        a flower or fruit motif; draw a motif only when the motif array contains it.

        [DESCRIPTION STRUCTURE]
        For each nail, use a compact but richly informative 2-3 sentence structure when needed.

        Sentence 1:
        Establish the base color, surface, finish, and major pattern.

        Sentence 2:
        Introduce the primary motif or parts and describe their physical material and visual effect.

        Optional Sentence 3:
        Describe supporting details, layering, reflective behavior, or how the focal decoration
        interacts with the nail surface.

        When a specific motif or part is selected, explicitly name it in the description using the
        exact controlled vocabulary term or a direct natural-language equivalent that preserves its meaning.
        The selected motif or part should remain visually important rather than being reduced to a
        background detail.

        [DESIGN RICHNESS]
        Unless the user explicitly requests a simple design with no rich reference, prefer a visually
        complete set rather than a sparse set.

        Keep the set calm and cohesive, like a real salon set. Across the whole set use roughly 3 to 5
        distinct decorative elements in total (motifs and parts together), including the ones the user
        named, and at most TWO decoration elements on any single nail (for example one motif plus one
        part). Leave one or two nails quiet (plain color, soft gradient, or a single tiny accent). Add one
        or two mood-fitting supporting elements the user did NOT name (see
        [MOOD-BASED SUPPORTING ELEMENTS]) only if the set still feels simple. Base designs / patterns do
        not count toward this number; they are limited to three in total.
        These may come from finish, pattern, motif, parts, or clearly described material effects.

        Do not add an element that clashes with the mood merely to satisfy a count.
        When the user explicitly selected a pattern, motif, or part category, keep the user's choice
        as the priority, and create richness by adding compatible supporting elements, materials, and
        finish variation around it instead of overriding the request.

        [MOOD-BASED SUPPORTING ELEMENTS - VERY IMPORTANT]
        The user usually names only one or two elements (for example a ribbon and a flower). That is a
        starting point, not the whole design. Keep every element the user named, but do NOT cover all
        five nails with only those elements. Read the mood and add supporting elements that a real nail
        artist would pair with it, using ONLY controlled vocabulary values:
        - lovely / feminine / sweet / romantic: lace (pattern), heart charm / pearl bead / pearl trim /
          rhinestone / bow charm 3d (parts), heart (motif), cheek blush or a soft french tip (pattern)
        - cute / kitsch / playful: heart, star, bunny (motif), polka dot, plaid, stripe (pattern),
          heart charm, star charm, bow charm 3d, rhinestone (parts)
        - chic / elegant / modern: french tip, line art, color block (pattern), pearl trim, chain,
          metal stud, rhinestone (parts)
        - cool / edgy / dark: cross, star, butterfly (motif), speckle, marble (pattern), chain,
          metal stud, star charm (parts)
        - y2k / glam: star, butterfly (motif), rhinestone, star charm, chain (parts), chrome or glitter
          (finish)
        - natural / minimal / vintage: watercolor, gradient, line art (pattern), tiny pearl bead,
          leaf (motif)
        Distribute them like this: the nail with the user's main element is the hero; a second nail
        carries the user's other named element; one or two of the remaining nails carry a DIFFERENT
        supporting element or part from the mood list above (for example one nail with a heart charm or
        a rhinestone cluster), and the rest stay quiet. At least one supporting element should be
        a motif (such as heart, star, butterfly), not only a part. Prefer motifs and parts as supporting
        elements; add a new base design / pattern (lace, french tip, polka dot, ...) only if the set
        stays within three distinct base designs in total. If the
        confirmed input has a "[VARIATION LEAN]" with "supporting elements to try", use those that fit
        the mood. A user-named motif may appear on at most three nails, and no two nails may have the
        same combination of motif, part, and pattern.
        Every description must name its element and, for parts, its material, size, and color.
        If the user declined motifs or parts ("none" / "없음") or asked for a minimal design, skip this
        rule.

        [STYLE TOOLBOX - MIX PER FINGER - VERY IMPORTANT]
        Build each nail by choosing options from these four axes (an axis may be skipped when it does not
        suit the nail). All five nails keep the same mood, palette, and shape, but each nail combines the
        options differently, like a real salon display sheet.

        1) Color expression (how the base color looks):
           - syrup: translucent jelly syrup-gel color (finish "jelly")
           - solid: opaque, even solid color (no color finish)
           - magnetic: magnetic gel (finish "magnetic cat eye") rendered by default as a ROUND GLASS-BEAD
             glow — a soft, domed, pearly gleam gathered into a rounded blob in the center of the nail, like
             a glossy glass bead or pearl sitting in clear gel, with a bright clean highlight on top. It is
             NOT a stripe, band, diagonal line, spiral, or swirl. The magnetic gleam is SILVER or GOLD
             (champagne) only, never holographic, rainbow, or iridescent multi-color, unless the user
             explicitly asks for a special combination (for example a guava nail: green base with a pink
             magnetic gleam). It has NO visible particles, specks, or sparkle, so it never looks like glitter.
           - glitter: ultra-fine micro glitter (finish "glitter") — tiny, dust-fine, densely scattered
             sparkles that give a delicate, even shimmer. Never large flakes, chunky pieces, or hexagon
             confetti. Glitter and magnetic must never be described with the same wording.
             Use glitter on at most TWO nails of the set (unless the user explicitly asks for more), and
             never describe glitter on a nail whose finish array does not contain "glitter".
        2) Parts / motif rendering (how decorations are made):
           - 3D: raised physical decoration made of plastic, embossed gel, silver metal, pearl, or resin
             (parts such as "bow charm 3d", "heart charm", "star charm", "pearl bead", "rhinestone", or the
             finish "sculpted 3d" for embossed gel)
           - drawing: a flat hand-drawn motif (motif values such as "bow ribbon", "heart", "flower"; checks
             and lines use the pattern "plaid" or "line art"). There are two drawing styles, pick one per
             nail and name it in the description:
             a) doodle drawing: a naive, childlike outline drawing — simple shapes with slightly imperfect
                proportions, as if a kid drew it, traced by outline only or lightly filled in (good for
                cute, kitsch, playful moods). The shape may be naive, but the LINE ITSELF must be smooth:
                a solid, evenly colored, evenly glossy stroke like a smooth gel pen, with no grain, no
                bumps, no lumps, no fuzzy or rope-like texture.
             b) painted flowers only: soft smudged painted blooms follow the [FLOWER ART RENDERING] rule.
             Every other flat motif (stars, hearts, ribbons, bows, butterflies, bunnies, crosses, leaves,
             shells) is EITHER a doodle outline (a) OR a raised 3D piece (a part, or the finish
             "sculpted 3d" for embossed gel). There is no third option: never a shaded, refined,
             illustrated, or semi-realistic drawing, and never a sticker / decal / printed clip-art look
             (a flat glossy printed shape pasted on the nail). Thin hairline illustrations do not exist in
             real nail art.
        3) Design (the base design of the nail):
           - gradient (pattern "gradient"), cheek (pattern "cheek blush"), ink (pattern "watercolor",
             spreading ink-blot bleed), marble (pattern "marble"), french (pattern "french tip")
           - blooming (pattern "watercolor"): a milky, translucent gel base with soft blurred round dots of
             pigment whose edges bleed outward in feathered halos, darker in the center and fading to
             nothing at the rim, lined up in a curved chain, arc, ring, or heart shape. It is NOT a flower
             drawing; the dots are the whole design.
        4) Finish (the top surface of the whole set):
           - The whole set is EITHER matte OR glossy, decided once with the top-level "surface" value.
             A matte set is matte on all five nails (no mixing of matte and glossy nails).
           - Inside a glossy set, individual nails may be plain glossy or powder (finish "powder finish").
           - A matte set uses only solid colors (no syrup, magnetic, glitter, or powder); create variety
             through the base design (gradient, cheek, ink, marble, blooming, french) and the parts /
             motif rendering instead.
           - If the user's words say matte or glossy, follow them for the whole set.

        Mixing rules:
        - Example for a lovely cute glossy set, for illustration only (do not copy it): thumb = syrup +
          cheek + glossy; index = solid + french + doodle star; middle = syrup + silver 3D bow + glossy; ring =
          solid + one 3D pearl + glossy; pinky = syrup + powder (quiet). It uses only two color expressions
          (syrup and solid).
        - LIMIT ON COLOR EXPRESSIONS: use at most TWO of the four color expressions (syrup, solid, magnetic,
          glitter) across the whole set — for example syrup + solid, or syrup + magnetic. Do not use three
          or four. Every nail uses one of those two. The other axes provide the variety.
        - At least three nails must differ from each other in at least one axis, and no two nails may
          share the same full combination. Some nails may use only one or two axes so the set has quiet
          nails and busy nails; do not stack many effects on one nail.
        - LIMIT ON DESIGNS: across the whole set, use at most THREE distinct base designs / patterns
          (gradient, cheek blush, marble, french tip, watercolor / ink / blooming, polka dot, plaid, stripe,
          line art, lace, color block, speckle), counting the ones the user named. Keep it calm: variety
          should mostly come from motifs, parts, and color expression, which may be as varied as you like.
          Do not pile several designs on one nail (at most one base design per nail).
        - CHEEK BLUSH is only allowed on syrup (jelly) nails. A nail with cheek blush must have finish
          "jelly", and must never combine with glitter, magnetic, or a solid opaque base.
        - A nail never combines glitter with another strong effect (cheek blush, magnetic, powder, french
          tip): glitter nails stay simple.
        - SMOOTH LINES: every drawn motif (stars, hearts, ribbons, spirals, dots) is a smooth, even, solid
          stroke with clean edges. Never describe lumpy, bumpy, grainy, rough, beaded, fuzzy, or rope-like
          lines.
        - COLOR SPREAD: a motif's own color must stay close to its outline. If a motif is soft or
          watercolor-like, its edges may blur only slightly (within a small margin around the motif); its
          color must never wash widely across the nail or tint the surrounding gel. Aura / watercolor /
          marble background colors must come from a different, subtle color family than the motif colors.
        - Keep the user's named elements. Fill the other nails by mixing the axes above in ways that fit
          the mood.
        - If the confirmed input has a "suggested axis combination per nail", use it as the starting
          point for each nail's color expression, base design, and finish (matte or glossy or powder), then
          add the user's named elements and the parts / motif rendering on top. Change a suggestion only
          when it clashes with the mood or the user's words.
        - Name the chosen options in each description (for example "syrup base", "doodle bow ribbon", "silver
          3D heart", "chunky ivory 3D bow"), so the image model does not fall back to a default look.

        [SURFACE / FINISH COMPATIBILITY]
        If the top-level surface is matte, do not use glitter, chrome, jelly, magnetic cat eye, or powder
        finish on any nail.
        If the top-level surface is glossy, all finish values are permitted unless another user rule
        conflicts.

        [USER'S OWN WORDS - HIGHEST PRIORITY]
        If the confirmed input contains a section with the user's own chat messages, every concrete
        request in it (decorations, parts, materials, colors, placement) MUST appear in the output.
        Never drop, soften, or replace such a request, even if it conflicts with "simple", with a
        finish rule, or with an earlier "none" selection (a later explicit request cancels "none").
        Map Korean terms to the controlled vocabulary and ALSO name the element in the nail
        descriptions:
        - 큐빅, 스톤, 보석, 크리스탈, 쥬얼 -> parts: "rhinestone" (sharp, faceted, sparkling gems)
        - 진주, 펄 비즈 -> parts: "pearl bead"
        - 리본 입체, 리본 참 -> parts: "bow charm 3d"
        - 체인 -> parts: "chain"; 메탈 스터드, 징 -> parts: "metal stud"
        - 소용돌이, 스월, 스파이럴 -> pattern: "line art" (a thin spiral line, see the spiral rule)
        If the user did not say which fingers, place the element on at least two or three nails as a
        clear focal accent (not on every nail), clustered near the cuticle or tip.

        [USER-SPECIFIED PRIORITY]
        The confirmed input is authoritative.
        If the user specified a finger-by-finger design, follow that assignment exactly.
        If the user specified a finger-by-finger exclusion, do not use that excluded element on that finger.

        If only some fingers are specified and no style is given for the others:
        - keep the specified fingers exactly as requested
        - design the remaining fingers using the shared set palette and mood
        - do not leave the remaining fingers empty unless the user explicitly requested that

        If the user asks to combine multiple styles without assigning them to specific fingers,
        distribute the styles naturally across the five nails.

        [TEXT / LETTERING]
        If the user explicitly requests a letter, initial, or word to appear on a nail,
        preserve the exact requested characters and include the corresponding lettering element.
        Do not invent or modify the requested text.

        [EDIT MODE - PREVIOUS PLAN]
        %s

        [CONFIRMED INPUT]
        %s

        Return JSON only. No markdown, no commentary, no code fences.
        Use exactly this JSON structure:
        {
          "shape": "...",
          "mood": "...",
          "season": "none",
          "surface": "...",
          "color": "...",
          "thumb":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "index":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "middle": { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "ring":   { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "pinky":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" }
        }
        """;

    private static final List<String> LEAN_CHARM_LOOKS = List.of(
            "tiny polished silver metal charm",
            "large chunky ivory opaque plastic charm",
            "transparent clear resin 3D charm",
            "glossy candy-colored or pearl-tinted acrylic charm",
            "heavy sculpted chrome silver charm",
            "matte black enamel charm");

    private static final List<String> LEAN_PLACEMENTS = List.of(
            "accents near the cuticle", "accents at a tip corner", "accents along one side edge",
            "a diagonal line of accents across the nail", "scattered small accents", "accents along the free edge");

    private static final List<String> LEAN_RENDERINGS = List.of(
            "raised thick glossy gel", "flat watercolor with softly bleeding edges");

    private static final List<String> LEAN_HERO_NAILS = List.of("thumb", "index", "middle", "ring", "pinky");

    // 보조 요소는 모티프/파츠만 — 베이스 디자인(패턴)은 세트당 3개 이내로 제한하기 때문에 여기서 부추기지 않는다.
    private static final List<String> LEAN_SUPPORTING = List.of(
            "heart motif", "heart charm", "star charm", "pearl trim", "pearl bead", "rhinestone cluster",
            "bow charm 3d", "butterfly motif", "star motif", "flower motif", "bunny motif", "chain", "metal stud");

    // 스타일 도구상자 축: 색 표현 / 디자인 / 마감. 자주 쓰이는 값은 중복해서 가중치를 준다.
    private static final List<String> TOOL_COLOR = List.of("syrup", "syrup", "solid", "solid", "magnetic", "glitter");
    private static final List<String> TOOL_DESIGN = List.of("gradient", "cheek", "ink", "marble", "blooming",
            "french", "no base design", "no base design");
    private static final List<String> TOOL_FINISH_GLOSSY_SET = List.of("powder", "glossy", "glossy", "glossy");
    private static final List<String> FINGERS = List.of("thumb", "index", "middle", "ring", "pinky");

    /**
     * 세트 단위 마감(전체 매트 또는 전체 글로시)을 먼저 정하고, 손톱별 (색 표현 + 디자인 + 마감) 조합을 뽑는다.
     * 매트 세트는 전부 솔리드 + 매트이고, 글로시 세트는 손톱마다 글로시/파우더가 섞일 수 있다.
     * 파우더는 자석/글리터와 섞지 않는다.
     */
    private String buildAxisSkeleton() {
        java.util.concurrent.ThreadLocalRandom r = java.util.concurrent.ThreadLocalRandom.current();
        boolean matteSet = r.nextInt(100) < 25;
        // 세트 전체에서 쓸 베이스 디자인은 최대 2개만 뽑고(사용자가 지정한 것까지 합쳐 3개 이내), 치크는 시럽 전용이라
        // 시럽이 없는 매트 세트에서는 제외한다.
        // 색 표현은 세트당 최대 2개: 시럽·솔리드 쪽 가중, 자석/글리터는 가끔.
        List<String> colorPool = new java.util.ArrayList<>(List.of("syrup", "syrup", "solid", "solid", "magnetic", "glitter"));
        java.util.Collections.shuffle(colorPool, r);
        List<String> colorPair = new java.util.ArrayList<>();
        for (String c : colorPool) {
            if (!colorPair.contains(c)) colorPair.add(c);
            if (colorPair.size() == 2) break;
        }
        List<String> designPool = new java.util.ArrayList<>(List.of("gradient", "cheek", "ink", "marble", "blooming", "french"));
        if (matteSet || !colorPair.contains("syrup")) designPool.remove("cheek");
        java.util.Collections.shuffle(designPool, r);
        List<String> setDesigns = designPool.subList(0, 2);
        int glitterNails = 0;
        java.util.Set<String> used = new java.util.HashSet<>();
        StringBuilder sb = new StringBuilder(matteSet ? "whole set is MATTE: " : "whole set is GLOSSY: ");
        boolean first = true;
        for (String finger : FINGERS) {
            String color = "solid", design = "no base design", finish = matteSet ? "matte" : "glossy";
            for (int attempt = 0; attempt < 40; attempt++) {
                design = r.nextInt(100) < 60 ? setDesigns.get(r.nextInt(setDesigns.size())) : "no base design";
                if (matteSet) {
                    color = "solid";
                    finish = "matte";
                } else {
                    color = colorPair.get(r.nextInt(colorPair.size()));
                    finish = TOOL_FINISH_GLOSSY_SET.get(r.nextInt(TOOL_FINISH_GLOSSY_SET.size()));
                    if ("cheek".equals(design)) color = "syrup";
                    if ("glitter".equals(color) && (glitterNails >= 2 || !"no base design".equals(design))) color = colorPair.get(0).equals("glitter") ? colorPair.get(1) : colorPair.get(0);
                    if ("powder".equals(finish) && ("magnetic".equals(color) || "glitter".equals(color))) finish = "glossy";
                }
                if (used.add(color + "|" + design + "|" + finish)) break;
            }
            if ("glitter".equals(color)) glitterNails++;
            if (!first) sb.append("; ");
            first = false;
            sb.append(finger).append(" = ").append(color).append(" + ").append(design).append(" + ").append(finish);
        }
        return sb.toString();
    }

    private static boolean arrayContains(JsonNode arr, String value) {
        if (arr == null || !arr.isArray()) return false;
        for (JsonNode n : arr) if (value.equalsIgnoreCase(n.asText("").trim())) return true;
        return false;
    }

    private static void removeFromArray(ObjectNode obj, String field, String value) {
        JsonNode node = obj.get(field);
        if (!(node instanceof ArrayNode arr)) return;
        for (int i = arr.size() - 1; i >= 0; i--) {
            if (value.equalsIgnoreCase(arr.get(i).asText("").trim())) arr.remove(i);
        }
    }

    private static void addToArray(ObjectNode obj, String field, String value) {
        JsonNode node = obj.get(field);
        ArrayNode arr = node instanceof ArrayNode a ? a : obj.putArray(field);
        arr.add(value);
    }

    private static final java.util.regex.Pattern DECORATION_WORDS = java.util.regex.Pattern.compile(
            "(?i)spiral|swirl|star|heart|ribbon|bow|flower|\\bdots?\\b|pearl|rhinestone|crystal|charm|lace|butterfly|stud|chain|french|drawn|doodle");

    // ", with a few ultra-fine microglitter specks for brilliance" 같은 글리터 절만 도려낸다.
    private static final java.util.regex.Pattern GLITTER_CLAUSE = java.util.regex.Pattern.compile(
            "(?i),?\\s*(?:with|and|plus)\\s+(?:a few |some )?(?:[\\w-]+\\s+){0,3}?(?:micro-?)?glitter"
                    + "(?:\\s+(?:specks|particles|dust))?(?:\\s+for\\s+[\\w\\s]+?)?(?=[.,;]|$)");

    private static final java.util.regex.Pattern GLITTER_WORD = java.util.regex.Pattern.compile(
            "(?i)(?:[\\w-]+\\s+){0,2}?(?:micro-?)?glitter(?:\\s+(?:specks|particles|dust))?");

    /** 글리터가 허용되지 않는 손톱의 설명에서 글리터 표현을 정리한다. 모티프가 든 문장은 지우지 않고 글리터 부분만 뺀다. */
    private static String dropGlitterWording(String description) {
        StringBuilder kept = new StringBuilder();
        for (String sentence : description.split("(?<=[.!?])\\s+")) {
            String s = GLITTER_CLAUSE.matcher(sentence).replaceAll("");
            if (s.toLowerCase().contains("glitter")) {
                // 문장을 지우면 베이스 색 같은 정보까지 사라지므로, 글리터 표현만 광택 표현으로 바꾼다.
                s = GLITTER_WORD.matcher(s).replaceAll("glossy shine");
            }
            if (kept.length() > 0) kept.append(" ");
            kept.append(s);
        }
        return kept.length() == 0 ? description : kept.toString();
    }

    private static String colorType(JsonNode finger) {
        if (arrayContains(finger.path("finish"), "jelly")) return "jelly";
        if (arrayContains(finger.path("finish"), "magnetic cat eye")) return "magnetic";
        if (arrayContains(finger.path("finish"), "glitter")) return "glitter";
        return "solid";
    }

    private static final java.util.regex.Pattern MAGNETIC_WORD = java.util.regex.Pattern.compile(
            "(?i)(?:magnetic|cat[- ]eye)(?:\\s+cat[- ]eye)?(?:\\s+gel)?(?:\\s+(?:finish|effect|sheen))?");

    private static String dropMagneticWording(String description) {
        StringBuilder kept = new StringBuilder();
        for (String sentence : description.split("(?<=[.!?])\\s+")) {
            String s = sentence;
            if (MAGNETIC_WORD.matcher(s).find()) s = MAGNETIC_WORD.matcher(s).replaceAll("glossy");
            if (kept.length() > 0) kept.append(" ");
            kept.append(s);
        }
        return kept.length() == 0 ? description : kept.toString();
    }

    /**
     * 색 표현(시럽·솔리드·자석·글리터)은 세트당 최대 2종류. 3종류 이상이면 솔리드 + 가장 많이 쓰인 효과 1개만 남기고
     * 나머지 손톱은 솔리드로 돌린다. 치크 블러시 손톱이 있으면 시럽(jelly)을 남긴다.
     */
    private void limitColorExpressions(JsonNode plan) {
        java.util.Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        boolean cheekExists = false;
        for (String finger : FINGERS) {
            JsonNode f = plan.path(finger);
            if (f.isMissingNode()) continue;
            counts.merge(colorType(f), 1, Integer::sum);
            if (arrayContains(f.path("pattern"), "cheek blush")) cheekExists = true;
        }
        if (counts.size() <= 2) return;
        String best = null;
        for (String t : List.of("jelly", "magnetic", "glitter")) {
            if (counts.containsKey(t) && (best == null || counts.get(t) > counts.get(best))) best = t;
        }
        if (cheekExists) best = "jelly";
        for (String finger : FINGERS) {
            if (!(plan.path(finger) instanceof ObjectNode f)) continue;
            String type = colorType(f);
            if ("solid".equals(type) || type.equals(best)) continue;
            String description = f.path("description").asText("");
            switch (type) {
                case "glitter" -> {
                    removeFromArray(f, "finish", "glitter");
                    description = dropGlitterWording(description);
                }
                case "magnetic" -> {
                    removeFromArray(f, "finish", "magnetic cat eye");
                    description = dropMagneticWording(description);
                }
                case "jelly" -> {
                    removeFromArray(f, "finish", "jelly");
                    description = description.replaceAll("(?i)\\b(translucent|sheer)\\b", "opaque")
                            .replaceAll("(?i)\\b(syrup|jelly)\\b", "solid");
                }
                default -> { }
            }
            f.put("description", description);
        }
    }

    /**
     * 조합 규칙을 코드로 강제한다 (프롬프트 지시만으로는 GPT가 가끔 어김):
     * - 치크 블러시는 시럽(jelly)에서만: 글리터/자석/크롬 제거, jelly 보장
     * - 글리터는 최대 2개 손톱 (사용자가 직접 글리터를 말한 경우는 제외), 글리터가 허용되지 않는 손톱의 글리터 문장은 정리
     */
    private void enforceCombinationRules(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode)) return;
        String userInput = confirmedInput == null ? "" : confirmedInput.toLowerCase();
        boolean userAskedGlitter = userInput.contains("glitter") || userInput.contains("글리터") || userInput.contains("반짝");
        int glitterNails = 0;
        for (String finger : FINGERS) {
            if (!(plan.path(finger) instanceof ObjectNode f)) continue;
            boolean cheek = arrayContains(f.path("pattern"), "cheek blush");
            boolean glitter = arrayContains(f.path("finish"), "glitter");
            if (cheek) {
                removeFromArray(f, "finish", "glitter");
                removeFromArray(f, "finish", "magnetic cat eye");
                removeFromArray(f, "finish", "chrome");
                if (!arrayContains(f.path("finish"), "jelly")) addToArray(f, "finish", "jelly");
                glitter = false;
            }
            if (glitter) {
                glitterNails++;
                if (!userAskedGlitter && glitterNails > 2) {
                    removeFromArray(f, "finish", "glitter");
                    glitter = false;
                }
            }
            String description = f.path("description").asText("");
            if (!glitter && (cheek || !userAskedGlitter) && description.toLowerCase().contains("glitter")) {
                description = dropGlitterWording(description);
            }
            if (cheek) {
                // 치크는 시럽 전용이라 불투명/솔리드 표현이 남아 있으면 시럽 표현으로 바꾼다.
                description = description.replaceAll("(?i)\\bopaque\\b", "translucent").replaceAll("(?i)\\bsolid\\b", "syrup");
            }
            f.put("description", description);
        }
        limitColorExpressions(plan);
    }

    private String buildVariationLean() {
        java.util.concurrent.ThreadLocalRandom r = java.util.concurrent.ThreadLocalRandom.current();
        List<String> pool = new java.util.ArrayList<>(LEAN_SUPPORTING);
        java.util.Collections.shuffle(pool, r);
        String supporting = String.join(", ", pool.subList(0, 3));
        return "\n[VARIATION LEAN] For this request only, supporting elements to try (use those that fit the mood): "
                + supporting + "; lean toward: charm look = "
                + LEAN_CHARM_LOOKS.get(r.nextInt(LEAN_CHARM_LOOKS.size()))
                + "; accent placement = " + LEAN_PLACEMENTS.get(r.nextInt(LEAN_PLACEMENTS.size()))
                + "; spiral / dot / line rendering = " + LEAN_RENDERINGS.get(r.nextInt(LEAN_RENDERINGS.size()))
                + "; flat motifs = doodle outline with a smooth gel-pen line, or a raised 3D piece"
                + "; hero nail = " + LEAN_HERO_NAILS.get(r.nextInt(LEAN_HERO_NAILS.size()))
                + "; suggested axis combination per nail (color expression + base design + finish): "
                + buildAxisSkeleton()
                + ". These are soft suggestions: use them as the starting point and change any that clash with"
                + " the mood or the user's words.\n";
    }

    private static final String MOTIF_NONE_RESTRICTION = """
        [EXPLICITLY NO MOTIF / PARTS - VERY IMPORTANT]
        If the confirmed input explicitly says motif/parts are "none" or "없음",
        treat that as an explicit prohibition, not as an omitted field.

        In that case, do not add any of the following anywhere in the five nail descriptions
        or motif/parts arrays:
        rhinestone, pearl bead, pearl trim, bow charm 3d, star charm, heart charm,
        metal stud, chain, bow ribbon, star, heart, flower, butterfly, cross, bunny,
        leaf, shell, character, lettering.

        Do not add these elements merely to satisfy design richness.
        Create visual richness only through allowed finishes, patterns, color relationships,
        surface effects, translucency, gloss, and other non-motif visual language.
        """;

    /**
     * 참고 이미지 없이 플랜 생성
     */
    public JsonNode generatePlan(String confirmedInputSummary) {
        return generatePlan(confirmedInputSummary, null, null, null, null);
    }

    /**
     * 참고 이미지(base64)와 함께 플랜 생성 (새 디자인, 이전 플랜 없음)
     * @param imageBase64  base64로 인코딩된 이미지 (없으면 null)
     * @param imageMimeType 예: "image/jpeg", "image/png"
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType) {
        return generatePlan(confirmedInputSummary, imageBase64, imageMimeType, null, null);
    }

    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType, String previousPlanJson) {
        return generatePlan(confirmedInputSummary, imageBase64, imageMimeType, previousPlanJson, null);
    }

    /**
     * "수정하고 싶어요" 흐름 전용: 직전에 만들어졌던 플랜(previousPlanJson)을 같이 넘겨서,
     * 사용자가 요청한 부분만 바꾸고 나머지 손가락/필드는 이전 문구를 그대로 유지하도록 한다.
     * 이걸 안 넘기면(=previousPlanJson이 null) 매번 완전히 새로 창작하듯 플랜을 만들어서,
     * "새끼손가락에 파츠 하나만 추가해줘" 같은 사소한 수정에도 5개 손가락이 전부 바뀌어버렸다.
     *
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType,
                                 String previousPlanJson, String userSeason) {
        return generatePlan(confirmedInputSummary, imageBase64, imageMimeType, previousPlanJson, userSeason, false);
    }

    /**
     * @param scanAutoMode 스캔 정보 기반 자동 생성이면 true. 이 경우 "손가락별 지정도 참고 이미지도
     *                     없으면 손가락 필드를 전부 비운다"는 기본 규칙을 덮어쓰고,
     *                     추천 팔레트에서 고른 색을 손가락별로 분산시켜 원컬러가 아닌 디자인을 만들게 한다.
     */
    public JsonNode generatePlan(String confirmedInputSummary, String imageBase64, String imageMimeType,
                                 String previousPlanJson, String userSeason, boolean scanAutoMode) {

        String editModeSection = "";
        if (previousPlanJson != null && !previousPlanJson.isBlank()) {
            editModeSection = """
                    [PREVIOUS DESIGN PLAN - VERY IMPORTANT]
                    This request is an edit of the previous design plan, not a completely new design.
                    Preserve every field that the user did not explicitly ask to change.

                    - If a finger or field is not mentioned by the user, copy its previous value exactly.
                    - If a specific finger is mentioned, change only that finger's description,
                      finish, pattern, motif, parts, and base_color as needed.
                    - Keep the other four fingers unchanged.
                    - If a finger-level preference or exclusion is present in the confirmed input,
                      that instruction has priority over the previous plan for that finger.
                    - Keep top-level shape, mood, season, surface, and color unchanged unless the user
                      explicitly asks to modify them.
                    - Do not invent new HEX color values. Preserve previous HEX values.

                    [PREVIOUS PLAN JSON]
                    %s
                    """.formatted(previousPlanJson);
        }

        // ★ 사진 기반 생성일 때는 트렌드 힌트 제외 (이미지 색감 우선)
        boolean hasImage = imageBase64 != null && !imageBase64.isBlank();
        String trendHint = hasImage ? "" : styleTrendService.buildTrendHint(userSeason);
        String motifNoneRestriction = hasImage ? "" : MOTIF_NONE_RESTRICTION;
        // ★ 같은 입력이면 GPT가 매번 같은 레시피를 고르는 문제 — 새 디자인(수정/참고이미지 아님)일 때만
        // 요청마다 무작위 "기울기"를 부드러운 제안으로 넘겨 결과가 달라지게 한다.
        String variationLean = (hasImage || (previousPlanJson != null && !previousPlanJson.isBlank()))
                ? "" : buildVariationLean();
        // ★ 스캔 정보 기반 자동 생성 모드: 사용자 입력이 하나도 없으므로 "지정이 없으면 비운다"는 규칙 대신
        // 추천 팔레트에서 색을 직접 골라 손가락별로 다르게 분산시키도록 지시한다.
        String scanAutoSection = "";
        if (scanAutoMode) {
            scanAutoSection = """
                    [SCAN-BASED AUTO MODE - OVERRIDES THE RULES ABOVE]
                    The user entered no preferences at all, and there is no reference image and no
                    per-finger instruction. In this mode do NOT leave the finger fields empty. Instead,
                    choose 2 to 4 colors that go well together from the "color 후보" palette in the
                    confirmed input, and:
                    - Write the HEX codes of the chosen colors in the top-level color field, copied exactly
                      as written in the palette and separated by commas (for example "#E8B4C0, #F5E1D3"),
                      without the color names in parentheses. In descriptions, name these colors in natural
                      English as the color rules above require. Only the chosen colors need to appear on
                      the nails, not the whole palette.
                    - Fill mood and the base designs / motifs yourself to match the mood of those colors.
                      Never make a one-color design.
                    - Give at least two fingers different base_color values, and give the remaining fingers
                      different details (finish, gradient, pattern) so the set varies.
                    - Give at least one finger an accent part that fits the colors and mood.
                    - Keep the five nails coherent as one set.
                    - Use the recommended shape written in the confirmed input exactly; never change it.
                    """;
        }
        String systemPrompt = String.format(SYSTEM_PROMPT, trendHint + variationLean, motifNoneRestriction,
                editModeSection + scanAutoSection, confirmedInputSummary);

        // [Gemini 방식 - 주석 처리]
        // List<Map<String, Object>> parts = new ArrayList<>();
        // if (imageBase64 != null && imageMimeType != null) {
        //     parts.add(Map.of(
        //             "inline_data", Map.of(
        //                     "mime_type", imageMimeType,
        //                     "data", imageBase64
        //             )
        //     ));
        //     parts.add(Map.of("text", "..."));
        // } else {
        //     parts.add(Map.of("text", "위 정보로 5개 손가락 디자인을 생성해주세요."));
        // }
        //
        // Map<String, Object> requestBody = Map.of(
        //         "contents", List.of(Map.of("role", "user", "parts", parts)),
        //         "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
        //         "generationConfig", Map.of(
        //                 "responseMimeType", "application/json",
        //                 "maxOutputTokens", 8192,
        //                 "thinkingConfig", Map.of("thinkingLevel", "MEDIUM")
        //         )
        // );
        //
        // JsonNode responseNode = callGeminiWithRetry(requestBody);
        // String text = responseNode.path("candidates").get(0)
        //         .path("content").path("parts").get(0).path("text").asText();

        //5개 손가락+파츠까지 담아야 해서 응답이 길어질 수 있으므로 토큰을 넉넉히.
        //시스템 프롬프트에 지켜야 할 규칙(색상 개수별 처리, richness, 비호환 조합,
        //자기검증 체크리스트 등)이 많아서 안정적인 준수를 위해 넉넉한 토큰으로 호출.
        String userInstruction = "If a reference image is provided, carefully inspect its overall color palette, mood, decoration density, " +
                "material, gloss, dimensionality, and product-photography quality. Create five nail designs that are visually " +
                "distinct yet clearly belong to one premium coordinated set. Map finish/pattern/motif/parts to the controlled " +
                "vocabulary, and write each description as a concrete visual instruction that can be passed directly to the " +
                "final image-generation model.";
        String text;
        if (imageBase64 != null && imageMimeType != null) {
            text = gptClientService.chatWithImage(systemPrompt, userInstruction, imageBase64, imageMimeType, 8192, true);
        } else {
            text = gptClientService.chat(systemPrompt, "Generate the five-finger nail design plan from the confirmed input above.", 8192, true);
        }

        try {
            JsonNode plan = objectMapper.readTree(text);
            enforceCombinationRules(plan, confirmedInputSummary);
            return plan;
        } catch (Exception e) {
            System.err.println("디자인 플랜 JSON 파싱 실패. 원본 응답: " + text);
            throw new IllegalStateException("디자인 플랜 생성 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
        }
    }

    // Gemini 호출 로직 - GPT(GptClientService)로 교체하면서 주석 처리 (롤백 대비, 삭제 안 함)
    // /**
    //  * Gemini 호출. 429(요청 한도 초과)면 잠깐 대기 후 최대 2회 재시도.
    //  */
    // private JsonNode callGeminiWithRetry(Map<String, Object> requestBody) {
    //     WebClient webClient = webClientBuilder.build();
    //     int maxAttempts = 3;
    //     long backoffMillis = 1500;
    //
    //     for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    //         try {
    //             return webClient.post()
    //                     .uri(apiUrl + "?key=" + apiKey.trim())
    //                     .bodyValue(requestBody)
    //                     .retrieve()
    //                     .bodyToMono(JsonNode.class)
    //                     .block();
    //         } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
    //             int statusCode = e.getStatusCode().value();
    //             boolean isRetryable = statusCode == 429 || statusCode == 503; // 429=요청과다, 503=모델 과부하
    //             boolean hasAttemptsLeft = attempt < maxAttempts;
    //
    //             System.err.println("Gemini API 호출 실패 (시도 " + attempt + "/" + maxAttempts + "): "
    //                     + e.getStatusCode() + " " + e.getResponseBodyAsString());
    //
    //             if (isRetryable && hasAttemptsLeft) {
    //                 try {
    //                     Thread.sleep(backoffMillis * attempt);
    //                 } catch (InterruptedException ie) {
    //                     Thread.currentThread().interrupt();
    //                 }
    //                 continue;
    //             }
    //
    //             if (isRetryable) {
    //                 throw new IllegalStateException("지금 AI 서버가 혼잡해서 디자인 플랜 생성이 지연되고 있어요. 잠시 후 다시 시도해 주세요.");
    //             }
    //             throw new IllegalStateException("디자인 플랜용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    //         }
    //     }
    //     throw new IllegalStateException("디자인 플랜용 AI 응답을 받아오지 못했어요. 잠시 후 다시 시도해 주세요.");
    // }
}