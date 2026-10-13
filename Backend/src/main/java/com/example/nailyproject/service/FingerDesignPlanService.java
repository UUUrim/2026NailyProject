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
        (This rule is only about what you observe in a reference image. It does NOT apply to a
        character the user names in words — see [USER-NAMED CHARACTER].)

        [SHAPE VALUE - VERY IMPORTANT]
        The top-level "shape" must be EXACTLY one of these six lowercase words, nothing else:
        round, oval, almond, stiletto, ballerina, square.
        The app only has these six nail shapes. Never write any other shape name or a combination
        (for example "rounded square", "squoval", "coffin", "tapered", "medium almond"); write the
        closest of the six instead (coffin -> ballerina, rounded square -> square). If the confirmed
        input names a shape, use it. If it does not and a reference image or recommended shape is
        given, pick the closest of the six.

        [REFERENCE SUBJECT LABEL - DISPLAY ONLY]
        If a reference image is provided and it clearly shows what it is - the title text on a poster or
        cover, or an unmistakable fictional work, character, game, brand or famous artwork - write its
        common Korean name in the top-level "reference_subject" field (for example "나루토",
        "스파이더맨", "별이 빛나는 밤"): just the name, no description. This is only a label shown to the
        user on the result screen. NEVER copy it into any description, finish, pattern, motif, parts or
        color value - the no-proper-names rule above still applies to every design field. Do not guess:
        if you are not sure, or the image is a real person, a plain photo, a pattern or a texture, use
        an empty string "". It is always "" when no reference image is provided.

        [USER-NAMED CHARACTER - VERY IMPORTANT]
        If the user's request names a specific character or mascot (for example Hachiware or Chiikawa,
        Kuromi, My Melody, Pompompurin, Miffy, Snoopy, Pikachu), they want THAT character on the nail,
        not a generic animal that merely resembles the word. Never replace it with a generic cat, bunny,
        or bear.
        - Keep the character's name in the description of the nail that carries it, and ALSO spell out
          its official look from your own knowledge: signature colors, markings, ear and head shape,
          face features, and cheek blush, so the image model can draw the right character.
        - Hachiware (from Chiikawa) is a small white cat-like character with SKY-BLUE ears and a
          sky-blue patch on top of the head split by a white inverted-V part, round black dot eyes, a
          small happy open mouth, and pink cheek blush. It is NOT gray, NOT black, and NOT a tuxedo cat.
          The word "hachiware" here means this character, not just a cat with a parted coat.
        - Never recolor the character's signature hue (blue stays blue, pink stays pink). When that
          color is close to the nail base color, keep it readable by using a clearly deeper or lighter
          shade of the same hue plus a thin darker outline, and fill the face white, instead of
          changing the hue.
        - Only the line quality follows the doodle rule (smooth gel-pen stroke); the character's
          identity (colors and markings) must stay accurate. A character on a nail may be a partial
          view such as a peeking head or a single ear, but its markings must still match.

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
        or subtle surface effects when that produces a more complete design - always kept small and
        delicate as described in [REAL SALON REALISM].

        [REAL SALON REALISM - VERY IMPORTANT]
        The result must look like a real hand-made set from a Korean nail salon portfolio, not an AI
        render. Real sets are restrained and delicate (except a funky mood: see [FUNKY MOOD] when it is present),
        so every description follows these rules:
        - Scale: charms, pearls, rhinestones, and motifs are SMALL. A single charm or motif covers at most
          about a quarter of the nail and usually sits off-center (near the cuticle, a tip corner, or a side
          edge), leaving most of the nail as a bare sheer base. Never an oversized flower or bow filling
          the nail. State the size in the description ("small", "tiny", "mini").
        - Color: soft, sheer, milky, slightly desaturated, and tonal. Avoid flat saturated candy pigment
          (for example a solid bubblegum pink). A gradient is a soft translucent blend of gel, not a
          digital two-color fade.
        - Charm material: resin or acrylic charms are milky, pearly, or translucent with slightly irregular
          hand-molded edges, set into a small bead of clear gel that blends them into the nail; metal
          charms are tiny and polished silver; pearls are small round beads; rhinestones are tiny.
          Never a big opaque glossy plastic blob.
        - Drawing: lines are thin and slightly imperfect, like real fine-brush or gel-pen strokes.
        - Quantity: one small accent per nail (two at most), and several nails stay quiet.
        - Write sizes and materials in the description in plain words (for example "small milky resin
          flower charm near the cuticle on a sheer pink syrup base").

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
        - soft rounded folds with smooth, plump loop surfaces - never ribbed, striped, pleated, or lined:
          no parallel line patterns, grooves, or ridges on the loops or tails
        - raised curved surfaces
        - visible physical thickness
        - clean outer edges
        - realistic specular highlights
        - dimensional depth
        - a subtle contact shadow beneath the charm
        - a clear material boundary between the bow and the nail

        Choose the bow's material, size, and color from the charm looks in
        [STYLE DIRECTION AND VARIATION] (tiny silver metal, small ivory opaque resin, transparent
        resin, candy-colored acrylic, sculpted chrome, matte black enamel) and from the wider range of
        forms and colors in [RIBBON / BOW VARIETY], and vary it between sets.
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
        - bow ribbon = flat painted, drawn, or low-relief embossed ribbon motif (see [RIBBON / BOW VARIETY])
        - bow charm 3d = separate raised physical bow accessory attached on top of the nail

        [RIBBON / BOW VARIETY - VERY IMPORTANT]
        Ribbons and bows come in endless forms in real nail art. Do NOT default to one ribbon (for example a
        thin white gel-pen outline bow, or the same chunky ivory bow every time). Whenever a ribbon or bow is
        used, decide its form, material, color, size, and placement, let the mood and the palette steer
        those choices, and name every choice concretely in the description. If a "[VARIATION LEAN]" lists
        "ribbon looks to try", prefer the first one for this request.

        DRAWN RIBBONS ARE RESTRICTED (VERY IMPORTANT): the flat drawn forms - fine hand-drawn line-art bow,
        tiny mini bows in outline, ribbon lacing, ribbon-band french, and doodle outline bows - are used
        ONLY when the user chose the drawing design type or a cute or kitsch mood, or asked for a drawn
        ribbon in words. Otherwise every ribbon is a raised 3D charm (parts "bow charm 3d") or a low-relief
        embossed ribbon. The [VARIATION LEAN] states whether drawn ribbons are allowed this time. Also, no
        ribbon surface ever has stripes, ribs, pleat lines, or parallel line patterns.

        DRAWN RIBBON LINE (VERY IMPORTANT): a drawn ribbon is a simple, delicate hand-drawn line-art bow with two
        loops, a small knot, and two flowing tails (they may cross or curl), drawn with a thin, even, light line in
        the color the user chose for the ribbon, or a slightly deeper tone of the ribbon's own color if none was
        chosen. It never has a heavy, dark, or black outline. On a plain (non-ink) nail the loops are empty; on
        an ink nail the loops, knot, and tails are filled with transparent ink color.

        ONE RIBBON LOOK PER SET (VERY IMPORTANT): the variety above is variety BETWEEN sets, never inside one
        set. Pick exactly one ribbon look for the whole set, and every ribbon or bow on every nail is that
        same look - the same dimension (all raised 3D charms, or all flat fine line-art, or all embossed, and
        never a mix of drawn and 3D), the same material, the same single color (decide one color name once
        and write that exact color word on every ribbon nail - never one white, one pink, and one black
        ribbon in the same set), and the same line style, written with the same wording in each nail's
        description. For example, if the look is a silver 3D bow
        charm, every bow in the set is a silver 3D bow charm. Only the size (tiny, small, large), the
        placement (cuticle, tip corner, side edge), and the tilt may differ between nails. If a ribbon
        also appears in a second design, keep it the same look and only change how many there are or how
        big they are.

        Forms seen in popular sets (examples only - invent others in the same spirit, never copy one
        literally):
        - puffy sculpted 3D bow in opaque white or ivory gel or acrylic with soft rounded folds, small to
          medium at the cuticle or sitting over a white V-shaped french band (soft, romantic, ballet)
        - plump glossy candy-resin 3D bow in dusty mauve, rose, or milk pink with a small knot, sitting on a
          cream or frosted tip (cute, sweet)
        - clear glass-like 3D gel bow: smooth plump transparent loops with one soft highlight each and a
          pearl at the knot, no ridges or stripes on the surface, on sheer or glittery jelly (clean, dreamy)
        - low-relief embossed ribbon bow with long flowing tails in a tonal shade and a tiny pearl at the
          knot, softly matte or satin against a glossy jelly base (romantic, natural)
        - delicate line-art bow: outline only, thin even light lines in the user's chosen color (or a
          slightly deeper tone of the ribbon color), hollow loops, a small knot, and flowing tails, often
          over a soft ink blob or blush (artsy, minimal, chic)
        - polished silver or antique metal bow charm with crisp edges, optionally with a delicate dangling
          chain and a tiny heart or pearl pendant (chic, y2k, cool)
        - tiny mini bows in thin silver or gold outline or foil, repeated along a line or scattered like
          trim (minimal, chic)
        - ribbon lacing: crisscross or zigzag ribbon bands laced across the nail with pearls or rhinestones
          where they cross (ballet, lovely), and ribbon-band french tips tied with a small bow
        - satin-like glossy bow with soft fabric folds in a bold color such as cherry red, powder blue,
          lavender, or black enamel (playful, cool, edgy)

        Choose along these axes independently, once for the whole set:
        1) Dimension: raised 3D charm, low-relief embossed gel, flat fine line-art, flat doodle outline, or
           tiny foil / outline mini motifs.
        2) Material and finish: opaque acrylic, glossy resin, clear glass-like gel, matte or satin gel,
           polished or antique metal, pearl-studded, glitter-filled clear gel.
        3) Color: white, ivory, cream, tonal pink, dusty mauve, clear / transparent, taupe or brown line,
           silver, gold, champagne, powder blue, lavender, red, black. It may follow the palette or
           deliberately contrast with it - it is NOT always white.
        4) Scale and tails (may differ per nail): tiny, small, or medium (never oversized); short loops or long flowing
           tails; with or without a knot jewel or a dangling chain.
        5) Placement (may differ per nail): at the cuticle, over a french tip, at a tip corner, along a side
           edge, hanging, or as a repeated trim.
        Mood guide (soft guidance, not a rule): cute / kitsch / playful -> plump candy-resin or satin bows in
        pastel or bold colors; lovely / romantic -> puffy white or tonal low-relief bows, ribbon lacing, and
        pearls; soft / minimal / natural / vintage -> fine line-art, clear glass-like, or tonal low-relief
        bows; chic / elegant / y2k -> metal bow charms and tiny mini bows; cool / edgy / dark -> black
        enamel or antique silver bows.

        Mapping to the controlled vocabulary: raised 3D charms (puffy, candy-resin, clear glass-like, metal,
        satin) use parts "bow charm 3d" (add "chain" for a dangling chain); a low-relief embossed ribbon bow
        uses motif "bow ribbon" with finish "sculpted 3d"; a fine line-art bow, tiny mini bows, and ribbon
        lacing use motif "bow ribbon", and the description must say "fine line-art", "tiny mini bows", or
        "ribbon lacing" so the image stage draws them as delicate artwork instead of a childlike doodle.
        A flat ribbon is never a sticker, decal, or printed clip-art look, and every drawn line stays smooth
        and clean.

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

        The only intended exceptions are a nail whose finish is "knit" (fine fiber flecks inside the color)
        and a nail whose finish is "ink" (ink-wash color and the ink check), which follow their own rules in
        [STYLE TOOLBOX].

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
        - glitter: extremely tiny pin-point grains, lightly and evenly scattered inside clear gel (not dense, not clumped, no large chunks) unless requested
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

        At least three nails (the three designs of [THREE-DESIGN ALTERNATING SET]) should have visibly
        different pattern/motif/parts/finish combinations when the user's request and reference image
        allow it; nails that share a design must differ in a visible accent.

        Use a clear visual hierarchy within each nail: one focal element plus supporting details.
        Avoid random decoration dumping, but do not under-decorate the set.

        Prefer a polished, high-information product design when the reference is rich.
        Preserve a balanced relationship between negative space and decorative density.

        [THREE-DESIGN ALTERNATING SET - VERY IMPORTANT]
        By default a set is built from exactly THREE designs that take turns across the five nails,
        like a real salon set: two of the designs appear on two nails each and the third on one nail
        (for example A B A C B, or A B C A B). A "design" is ONE of these:
        - a color effect: glitter, magnetic cat eye, powder finish, knit, or ink
        - a base pattern: gradient, marble, french tip, cheek blush, watercolor, blooming, and similar
        - a plain one-color nail (원컬러): solid or syrup with no base pattern and no color effect
        Examples, for illustration only (do not copy): glitter / gradient / glitter / one-color / gradient;
        gradient / one-color / gradient / marble / one-color; french tip / glitter / french tip /
        one-color / glitter.

        Rules:
        1) The design types the user selected (the "designType" line of the confirmed input, plus any
           design types named in the user's own words) are always among the three designs, but one
           design is NEVER used on more than two nails and NEVER on all five nails - even when the user
           selected only ONE design type. If the user selected only glitter, two nails get glitter and the
           other three nails get two OTHER designs that suit the mood and palette (for example gradient
           and one-color). With two selected types, they are two of the three designs and you add one
           complementary design (one-color is the safest). With three, those three are the set. With more
           than three, use every selected type on at least one nail, alternating as far as possible.
        2) Alternate: never put the same design on two neighbouring nails.
        3) If a "[THREE-DESIGN PLAN]" note is present (at the top of these instructions or in the confirmed
           input), use its nail-by-nail assignment as the default composition.
        4) The nails that share a design must still differ in a visible detail - a different accent (tiny
           part or motif), accent placement, glitter density, or gradient direction and color stops - so
           they are not copies. This relaxes the rules "no two nails may share the same combination" and
           "at least four nails must differ" only for nails that share a design.
        5) Every nail shares the syrup base expression by default (see [DEFAULT COLOR EXPRESSION - SYRUP]):
           one-color, gradient, marble, and french nails are syrup, glitter nails are syrup nails with
           glitter inside, powder nails are a pearl-powder glaze over syrup. Magnetic nails (only when the
           user selected magnetic) are the one other expression; solid only when the user asked for it.
        6) Exceptions: if the user asked for a one-color set, follow the ONE-COLOR rule; if the user
           assigned designs to specific fingers, follow that assignment exactly; if the user explicitly
           asks for a design on all nails or only that design (for example 모든 손톱, 전부, 글리터만, all
           nails, only glitter), apply it as asked; a matte set (surface matte) is decided for the whole
           set and is not one of the three designs - build the three designs without glitter, powder, and
           cheek blush; when a reference image defines the design, the image decides; in edit mode follow
           the previous plan.
        Motifs and parts are separate from these designs: they follow the hero / accent rules.

        [STYLE DIRECTION AND VARIATION - VERY IMPORTANT]
        Do not use one fixed recipe. First read the confirmed mood, season, colors, and the user's own
        words, and decide a style direction, for example: cute / kitsch / playful, sweet / romantic,
        soft / minimal / natural, chic / elegant, cool / edgy / dark, y2k / glam, vintage / autumn.
        Then choose HOW each element is rendered so it fits that direction, and make different choices
        on different nails of the same set.

        Rendering choices (pick by direction; do not always pick the first option):
        1) Charm look, for bow charm 3d, heart charm, star charm, cross, flower charm, and similar parts
           (bows have an even wider range - see [RIBBON / BOW VARIETY]).
           Choose one variant and state its material, size, and color in the description:
           - tiny polished silver metal charm with crisp edges (chic, y2k, edgy)
           - small ivory or cream opaque resin / acrylic charm with a soft glossy surface
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
        - Give the set one hero nail with the main motif (still small to medium, per [REAL SALON REALISM]), one or two accent nails
          that use a DIFFERENT motif, part variant, or placement, and keep the remaining nails quiet
          (plain color, soft gradient, or a single tiny accent).
        - Never repeat the same motif with the same scale, placement, and material on two nails. A motif
          may appear on another nail only if its scale, placement, charm variant, or rendering changes.
        - At least three nails must differ in motif, part, pattern, or placement (nails that share a
          design differ by their accent - see [THREE-DESIGN ALTERNATING SET]). Name the chosen variant
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
        glitter, chrome, jelly, magnetic cat eye, foil, powder finish, sculpted 3d, knit, ink

        pattern (per-nail pattern array, 0-1 value per nail):
        french tip, gradient, cheek blush, marble, polka dot, plaid, stripe, line art,
        color block, lace, watercolor, blooming, speckle

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
        part; a funky mood overrides these limits, see [FUNKY MOOD]). Leave one or two nails quiet (plain color, soft gradient, or a single tiny accent). Add one
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
        - chic / elegant / modern: french tip, line art, color block, blooming (pattern), pearl trim,
          chain, metal stud, rhinestone (parts)
        - cool / edgy / dark / funky: cross, star, butterfly (motif), speckle, marble, blooming (pattern),
          chain, metal stud, star charm (parts)
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
        same combination of motif, part, and pattern (nails that share a design differ at least by
        their accent - see [THREE-DESIGN ALTERNATING SET]).
        Every description must name its element and, for parts, its material, size, and color.
        If the user declined motifs or parts ("none" / "없음") or asked for a minimal design, skip this
        rule.

        [CREATIVE LATITUDE - VERY IMPORTANT]
        Honor every choice the user made (selected options and their own words), the controlled vocabulary, and the
        hard rules, but treat everything the user did NOT specify as yours to design inventively. Do not default to
        the most obvious combination or repeat the same recipe from set to set: vary which nail is the hero, the
        asymmetry and placement of accents, the scale within the allowed limits, accent colors, finish mixes,
        edge-hugging or corner-cropped art, negative space, partial or reversed french tips, color-blocked
        halves, and gradient direction. The [THREE-DESIGN PLAN] and the [VARIATION LEAN] (including its creative
        twists) are starting points, not orders: you may re-assign designs among nails and add unexpected but
        harmonious ideas. If the same selection would produce a set that looks like a previous one, change
        something visible.

        [DEFAULT COLOR EXPRESSION - SYRUP - VERY IMPORTANT]
        The default color expression of EVERY nail is a syrup color (finish "jelly"): a translucent, juicy,
        glass-like jelly gel in which the pigment looks suspended in clear gel, the nail bed color glows
        softly through it, and a large soft mirror-like highlight sits on a thick, wet-looking surface - the
        trending Korean syrup-gel look. An opaque creamy pastel looks flat and cheap, so never use it by
        default.
        - It applies to every design of the set: gradient nails (a syrup gradient), marble, french tip, and
          one-color nails, and also glitter nails (ultra-fine glitter floating inside a syrup base: finish
          ["jelly", "glitter"]) and powder nails (a pearl-powder glaze over a syrup base: finish
          ["jelly", "powder finish"]).
        - Write "syrup" or "translucent syrup gel" in every description and describe its light transmission
          and glassy depth, as in [TRANSPARENCY AND JELLY REALISM].
        - Use a solid (opaque, no "jelly" finish) color only when the user asked for solid / opaque colors
          or a matte set. Magnetic cat eye, knit, and ink nails keep their own expression.
        - This default overrides any example below that shows a "solid" nail.

        [STYLE TOOLBOX - MIX PER FINGER - VERY IMPORTANT]
        Build each nail by choosing options from these four axes (an axis may be skipped when it does not
        suit the nail). All five nails keep the same mood, palette, and shape, but each nail combines the
        options differently, like a real salon display sheet.

        1) Color expression (how the base color looks):
           - syrup: translucent jelly syrup-gel color (finish "jelly") - the DEFAULT for every nail
           - solid: opaque, even solid color (no color finish) - only when the user asks for solid / opaque
             colors or a matte set
           - magnetic: magnetic gel (finish "magnetic cat eye") rendered by default as a ROUND GLASS-BEAD
             glow — a soft, domed, pearly gleam gathered into a rounded blob in the center of the nail, like
             a glossy glass bead or pearl sitting in clear gel, with a bright clean highlight on top. It is
             NOT a stripe, band, diagonal line, spiral, or swirl. The magnetic gleam is SILVER or GOLD
             (champagne) only, never holographic, rainbow, or iridescent multi-color, unless the user
             explicitly asks for a special combination (for example a guava nail: green base with a pink
             magnetic gleam). It has NO visible particles, specks, or sparkle, so it never looks like glitter.
           - glitter: (finish "glitter") ONLY a sparkle effect: a scattering of tiny bright points of light
             that twinkle inside a perfectly smooth, clear, even-colored syrup surface. Glitter adds no
             texture, no pattern, no grid, no net, no crackle, and no background marks of any kind - the
             color underneath stays one smooth clean tone, and only small glints of light are added. The
             glints are small, few to moderate in number, spread loosely, in the nail's own hue family
             (soft pink, rose, silver, or champagne). Never large flakes, chunky pieces, or hexagon
             confetti. Glitter and magnetic must never be described with the same wording. In the
             description write only the color and "fine sparkle" (for example "soft pink syrup with fine
             sparkle") - do not describe grains, dust, or texture.
             Glitter is not a separate base: a glitter nail is a syrup nail with the glitter floating inside
             (finish ["jelly", "glitter"]).
             Use glitter on at most TWO nails of the set (unless the user explicitly asks for it on more
             nails, for example all nails), and never describe glitter on a nail whose finish array does
             not contain "glitter".
           - knit: knit gel, also called velvet or "ppoguri" gel (finish "knit"): a soft, glossy, slightly
             milky-translucent gel color filled with a DENSE scatter of countless TINY short fiber fragments,
             like chopped wool or velvet flock, spread evenly over the whole nail and floating inside the clear gel.
             Each fragment is very short (about one thirtieth of the nail width) and thin, straight or slightly
             bent, at random angles, in lighter and darker tones of the same hue (some pale, some deeper, a few
             in a soft accent hue), so the nail reads as a fuzzy velvet made of tiny flecks. It is NOT a few long
             thin lines, cracks, veins, or scratches; NOT a woven or knitted fabric (no stitches, weave, yarn
             pattern, sweater texture, or felt); and NOT a hairy surface: the top coat stays smooth, glossy, and
             glass-clear. Colors are soft, sheer, girlish or muted (pink, raspberry, lilac, sky blue, aqua,
             pale ivory, gray-lavender, dusty rose, camel, forest green, charcoal). A cozy autumn / winter gel,
             sometimes done matte (velvet look), but usually glossy, and never the default. Use it only when the
             user asked for knit / velvet (니트, 벨벳), or the season or mood is clearly autumn / winter / cozy
             and the [THREE-DESIGN PLAN] assigns it. This fiber texture is the intended exception to [SURFACE
             CLEANLINESS]. A knit nail is a knit one-color nail: never combined with glitter, magnetic, powder
             or cheek blush, and never gets glitter wording. Write the color, "translucent knit gel", and
             "dense tiny fiber flecks floating inside the gel".
           - ink: ink gel (finish "ink"), a DRAWING ELEMENT used on top of a base color, not a replacement for
             the base: every ink nail has a base color laid first (by default the syrup base, so finish
             ["jelly", "ink"]; a clear or sheer natural base is allowed but is not the default). Ink itself is a
             vivid but fully transparent colored gel, like colored glass or marker ink: saturated, see-through,
             soft-edged color. It is used in three ways:
             a) Ink drawing art (the drawing design type): an ink illustration, like a cute hand-inked sticker.
                The motif's shapes are FILLED with transparent ink gel colors - sheer, saturated, slightly uneven
                watercolor-like color areas - on top of the base color, with at most a thin, light line in a
                slightly deeper tone of the same hue (no black or heavy dark outline). Small details (a knot,
                folds, a face, stripes) use the same light line. Use one to three harmonious fill colors from
                the palette. The ink fills must be clearly visible, and the motif must be clearly recognizable
                and fairly large (about half of the nail). Never abstract lines,
                lacing, spirals, raised gel lines, or pearls instead of a motif. Ink alone (a wash with no
                motif) is not a drawing, so every ink drawing nail carries a motif (ribbon, flower, clover,
                heart, star, lettering, a small cute character). When the user chose the drawing design type,
                use ink on the nails that carry the drawn art and give the other nails syrup or another base.
             b) An ink wash: soft ribbon-like or wave-like swaths of one vivid hue painted over part of the
                base color with soft, slightly pooled watercolor-like edges (not an airbrush gradient over the
                whole nail, not a milky blush).
             c) An ink check (gingham): pattern "plaid" with finish "ink" - wide see-through stripes of one
                vivid hue running in two directions, deeper where they cross, with soft hand-painted edges and no dark lines.
             Colors are bright and clear: raspberry, rose, coral, orange, yellow, lime, mint, aqua, sky blue,
             cobalt, violet. Ink is glossy only (never in a matte set). In the description write the base
             color (for example "soft pink syrup base") and the ink drawing, wash, or check on it.
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
             Every other flat motif (stars, hearts, butterflies, bunnies, crosses, leaves, shells) is
             EITHER a doodle outline (a) OR a raised 3D piece (a part, or the finish "sculpted 3d" for
             embossed gel). Ribbons and bows have more options (fine line-art, low-relief embossed, tiny
             mini bows, ribbon lacing - see [RIBBON / BOW VARIETY]). Otherwise there is no third option:
             never a shaded, refined, illustrated, or semi-realistic drawing, and never a sticker / decal /
             printed clip-art look (a flat glossy printed shape pasted on the nail). Thin hairline
             illustrations do not exist in real nail art, except the delicate fine line-art ribbons of
             [RIBBON / BOW VARIETY], which are drawn with real gel-pen lines.
        3) Design (the base design of the nail):
           - gradient (pattern "gradient"), cheek (pattern "cheek blush"), ink-blot (pattern "watercolor",
             spreading ink-blot bleed), marble (pattern "marble"), french (pattern "french tip")
           - blooming (pattern "blooming"): a sheer, glossy, translucent base (milky pink, nude, lilac, or clear) with
             large soft dots of ink pigment, each a FILLED blob like a drop of ink spreading in wet gel: the center
             of each dot is its darkest, most saturated part and the color fades smoothly outward into a blurred,
             feathered edge. By default the dots are BIG (each about one fifth to one quarter of the nail width) and
             FOLLOW THE OUTLINE of the nail: a row of dots along the curved free edge like a scalloped border, or
             along one side wall, with the dots touching or overlapping so they melt into a soft scalloped edge;
             or a small cluster of four dots forming a blossom near a corner or the tip. Not an S-curve and not a
             chain wandering across the middle of the nail. Never a ring, donut, hollow or outlined circle, white
             fluffy puff, or halo-only dot. The dots are one hue and always a deeper, more saturated tone than the
             base (for example wine, plum, or lilac on a nude base, smoke gray on a gray base), never white, with
             most of the nail left clean. It is often used in funky and chic moods. It is NOT a flower drawing and
             NOT outlined or polka dots; the spreading dots are the whole design of that nail.
        4) Finish (the top surface of the whole set):
           - The whole set is EITHER matte OR glossy, decided once with the top-level "surface" value.
             A matte set is matte on all five nails (no mixing of matte and glossy nails).
           - Inside a glossy set, individual nails may be plain glossy or powder (finish "powder finish").
           - A matte set uses only solid colors and knit (matte velvet) - no syrup, ink, magnetic, glitter,
             or powder; create variety through the base design (gradient, cheek, ink-blot, marble, blooming,
             french) and the parts / motif rendering instead.
           - If the user's words say matte or glossy, follow them for the whole set.

        Mixing rules:
        - Example for a lovely cute glossy set, for illustration only (do not copy it): thumb = syrup +
          gradient + glossy (design A); index = syrup + glitter + glossy (design B); middle = syrup +
          gradient + silver 3D bow + glossy (design A, different accent); ring = syrup one-color + one 3D
          pearl + glossy (design C); pinky = syrup + glitter + glossy with one tiny rhinestone near the
          cuticle (design B). It uses one color expression (syrup); the glitter nails are syrup nails with
          glitter inside.
        - LIMIT ON COLOR EXPRESSIONS: syrup is the base of every nail (see [DEFAULT COLOR EXPRESSION -
          SYRUP]). Besides syrup use at most ONE other expression across the whole set: solid (only when the
          user asked for it), magnetic, knit, or ink (when the user chose the drawing design type, that
          expression is ink). Do not use more. The other axes provide the variety.
        - At least three nails must differ from each other in at least one axis (the three designs of
          [THREE-DESIGN ALTERNATING SET]); the nails that share a design share its axes but differ by their
          accent. Some nails may use only one or two axes so the set has quiet nails and busy nails; do not
          stack many effects on one nail.
        - LIMIT ON DESIGNS: across the whole set, use at most THREE distinct base designs / patterns
          (gradient, cheek blush, marble, french tip, watercolor / ink-blot, blooming, polka dot, plaid, stripe,
          line art, lace, color block, speckle), counting the ones the user named. Keep it calm: variety
          should mostly come from motifs, parts, and color expression, which may be as varied as you like.
          Do not pile several designs on one nail (at most one base design per nail).
        - DOTS (polka dot): dots are EITHER the whole design of a nail - evenly spaced dots of one size
          covering the entire nail from cuticle to tip, with no other motif, part, wave, or ink swath on it -
          OR they sit only inside the french tip area of a french tip nail. Never scatter dots around or
          between other elements: a nail with a motif (cherry, flower, ribbon, heart, ...), a charm, a wave,
          or an ink swath has no dots, and a dot nail has no other motif. Dots are simple solid round dots
          with no outline (never outlined cartoon circles), and they are written as the pattern "polka dot",
          not as a motif.
        - CHECK (plaid): when the set combines check with the drawing design type or a cute mood, every check
          nail is a HAND-DRAWN check: soft translucent color bands running in two
          directions PLUS thin, slightly wobbly hand-drawn lines along and across the bands in an accent color of
          the palette (a deeper or contrasting tone), not perfectly straight, with uneven spacing and a few lines
          slightly overlapping or doubled, like a pen sketched over the bands. Write "hand-drawn wobbly check
          lines" in the description.
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
        - If a "[THREE-DESIGN PLAN]" is present (at the top of these instructions or in the confirmed
          input), use it as the starting point for each nail's color expression, base design, and finish
          (matte or glossy or powder), then add the user's named elements and the parts / motif rendering on
          top. Change it only when it clashes with the mood or the user's words.
        - Name the chosen options in each description (for example "syrup base", "doodle bow ribbon", "silver
          3D heart", "chunky ivory 3D bow"), so the image model does not fall back to a default look.

        [SURFACE / FINISH COMPATIBILITY]
        If the top-level surface is matte, do not use glitter, chrome, jelly, ink, magnetic cat eye, or powder
        finish on any nail (knit is fine: matte velvet).
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
        - 블루밍, 번지는 점 -> pattern: "blooming" (spreading ink-like dots, see the blooming design)
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
          "shape": "round | oval | almond | stiletto | ballerina | square (exactly one of these six words)",
          "mood": "...",
          "season": "none",
          "surface": "...",
          "color": "...",
          "reference_subject": "",
          "thumb":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "index":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "middle": { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "ring":   { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "pinky":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" }
        }
        """;

    private static final List<String> LEAN_CHARM_LOOKS = List.of(
            "tiny polished silver metal charm",
            "small ivory opaque resin charm",
            "transparent clear resin 3D charm",
            "glossy candy-colored or pearl-tinted acrylic charm",
            "heavy sculpted chrome silver charm",
            "matte black enamel charm");

    private static final List<String> LEAN_PLACEMENTS = List.of(
            "accents near the cuticle", "accents at a tip corner", "accents along one side edge",
            "a diagonal line of accents across the nail", "scattered small accents", "accents along the free edge");

    private static final List<String> LEAN_RENDERINGS = List.of(
            "raised thick glossy gel", "flat watercolor with softly bleeding edges");

    // 사용자가 정하지 않은 부분에서 모델이 다양한 시도를 하도록, 요청마다 두 가지를 무작위로 제안한다(선택 사항).
    private static final List<String> LEAN_TWISTS = List.of(
            "make a different finger the most decorated nail than usual and keep its neighbors very quiet",
            "place accents asymmetrically, hugging one side wall or the free edge instead of the center",
            "use negative space: leave a clean area and cluster the art in one corner",
            "try a partial or reversed french (a corner french, a side french, or a thin double french) if a french tip fits",
            "run a gradient diagonally or from the tip instead of from the cuticle",
            "split one nail into two color blocks or a color-blocked half",
            "echo one tiny element of the hero nail on another nail at a different scale",
            "mix two finishes in the set (for example one chrome accent nail among syrup nails) if the mood allows",
            "give one nail an unexpected palette color that is used only once",
            "stack a small cluster of mixed parts on one nail and keep two nails a single color",
            "try an off-center, tilted, or edge-cropped motif",
            "put the art on the upper half of one nail and only on the lower half of another");

    private static final List<String> LEAN_HERO_NAILS = List.of("thumb", "index", "middle", "ring", "pinky");

    // 리본/보우 변형: 힌트가 없으면 LLM이 가장 흔한 리본(하얀 젤펜 외곽선 등)으로 몰려서 매번 비슷한 리본이 나왔다.
    // 요청마다 무작위로 몇 가지를 제안해서 형태/재질/색이 달라지게 한다(전부 예시일 뿐 - 프롬프트 본문이 다른 변형도 허용한다).
    private static final List<String> LEAN_RIBBON_LOOKS = List.of(
            "puffy sculpted 3D bow in opaque white or ivory gel with soft rounded folds",
            "plump glossy candy-resin 3D bow with a small knot",
            "clear glass-like 3D gel bow with smooth plump transparent loops, one soft highlight on each loop and a pearl at the knot",
            "low-relief embossed ribbon bow with long flowing tails in a tonal shade and a tiny pearl at the knot",
            "delicate line-art bow outline in a soft deeper tone with hollow loops and flowing tails",
            "polished silver metal bow charm with a delicate dangling chain and a tiny heart or pearl pendant",
            "antique silver or black enamel bow charm with crisp edges",
            "tiny mini bows in thin silver or gold outline repeated along a line like ribbon trim",
            "ribbon lacing: crisscross ribbon bands laced across the nail with pearls or rhinestones where they cross",
            "ribbon-band french tip tied with a small bow",
            "satin-like glossy bow with soft fabric folds in a bold color",
            "glitter-filled clear gel bow with a pearl knot");

    private static final List<String> LEAN_RIBBON_COLORS = List.of(
            "tonal pink", "dusty mauve", "milk white", "ivory cream", "clear transparent", "silver", "champagne gold",
            "powder blue", "soft lavender", "cherry red", "chocolate brown", "black", "sage green", "butter yellow");

    // 보조 요소는 모티프/파츠만 — 베이스 디자인(패턴)은 세트당 3개 이내로 제한하기 때문에 여기서 부추기지 않는다.
    private static final List<String> LEAN_SUPPORTING = List.of(
            "heart motif", "heart charm", "star charm", "pearl trim", "pearl bead", "rhinestone cluster",
            "bow charm 3d", "butterfly motif", "star motif", "flower motif", "bunny motif", "chain", "metal stud");

    private static final List<String> FINGERS = List.of("thumb", "index", "middle", "ring", "pinky");

    // ── 세 가지 디자인이 번갈아 나오는 세트 ────────────────────────────────────────────

    private static final String DESIGN_ONE_COLOR = "one-color";

    // 사용자가 손가락을 직접 지정했거나 "모든 손톱"/"글리터만"처럼 한 가지를 명시한 경우 - 이때는 번갈아 나오는 구성을 강제하지 않는다.
    private static final java.util.regex.Pattern ALL_NAILS_OR_ONLY = java.util.regex.Pattern.compile(
            "(?i)(?:모든|전체|전부)\\s*(?:손톱|손가락|네일)|(?:손톱|손가락|네일)\\s*(?:전체|전부|모두)"
                    + "|\\ball\\s+(?:five\\s+)?(?:nails|fingers)\\b|\\bevery\\s+(?:nail|finger)\\b|\\ball\\s+five\\b"
                    + "|(?:글리터|그라데이션|마블|프렌치|파우더|마그네틱|치크)\\s*(?:으)?로?\\s*만\\s*(?:해|하|넣|채|꾸|부탁)"
                    + "|\\bonly\\s+(?:glitter|gradient|marble|french|powder|magnetic|cheek)\\b"
                    + "|\\b(?:glitter|gradient|marble|french|powder|magnetic|cheek)\\s+only\\b");

    private static final String FINGER_ASSIGNMENT_MARK = "[사용자가 명시적으로 지정한 손가락별 디자인";

    // 컬러는 기본이 시럽(반투명 젤)이다. 이 표현이 있으면 사용자가 솔리드/불투명/매트를 원하는 것이라 기본값을 적용하지 않는다.
    private static final java.util.regex.Pattern WANTS_OPAQUE = java.util.regex.Pattern.compile(
            "(?i)솔리드|\\bsolid\\b|불투명|\\bopaque\\b|꾸덕|매트|\\bmatte\\b");

    private static final java.util.regex.Pattern DESIGN_TYPE_LINE =
            java.util.regex.Pattern.compile("(?m)^designType:\\s*(.+)$");
    private static final java.util.regex.Pattern DESIGN_TYPE_AVOID_LINE =
            java.util.regex.Pattern.compile("(?m)^designType \\(피해야 함\\):\\s*(.+)$");

    // 드로잉 리본(가는 선화/미니 리본/리본 레이스업/낙서)은 사용자가 드로잉 타입이나 큐트/키치 같은 분위기를 골랐거나
    // 말로 요청했을 때만 허용한다. 그 외에는 입체 참이나 양각 리본으로 바꾼다.
    private static final java.util.regex.Pattern DRAWN_RIBBON_OK = java.util.regex.Pattern.compile(
            "drawing|드로잉|낙서|doodle|line\\s*-?art|라인\\s*아트|손그림|cute|큐트|귀여|kitsch|키치|funky|펑키|playful");
    private static final java.util.regex.Pattern DRAWN_RIBBON_WORDS = java.util.regex.Pattern.compile(
            "(?i)line[- ]?art|mini bows?|ribbon lacing|ribbon[- ]band|doodle|sketch|gel-pen|hand-drawn");
    private static final java.util.regex.Pattern DRAWN_TERMS = java.util.regex.Pattern.compile(
            "(?i)\\b(?:fine\\s+)?(?:hand-drawn|line[- ]?art|doodle|gel-pen|sketchy|sketch|drawn|outline|ribbon lacing|ribbon[- ]band)\\b");

    private static boolean drawnRibbonAllowed(String confirmedInput) {
        return DRAWN_RIBBON_OK.matcher(wantedPart(confirmedInput)).find();
    }

    /**
     * 드로잉이 허용되지 않았는데 플래너가 평면 리본(motif "bow ribbon", 양각 아님)을 넣었으면 입체 리본 참으로 바꾼다.
     * 설명 속 선화/낙서 표현을 지우고 "작고 매끈한 레진 3D 리본 참"이라는 문장을 덧붙인다.
     */
    private void enforceNoDrawnRibbon(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode) || drawnRibbonAllowed(confirmedInput)) return;
        for (String finger : FINGERS) {
            if (!(plan.path(finger) instanceof ObjectNode f)) continue;
            boolean flatRibbon = arrayContains(f.path("motif"), "bow ribbon")
                    && !arrayContains(f.path("finish"), "sculpted 3d")
                    && !arrayContains(f.path("parts"), "bow charm 3d");
            if (!flatRibbon) continue;
            removeFromArray(f, "motif", "bow ribbon");
            addToArray(f, "parts", "bow charm 3d");
            String description = DRAWN_TERMS.matcher(f.path("description").asText("")).replaceAll("")
                    .replaceAll("(?i)\\bin (?:thin|fine|delicate) [a-z ]{0,20}lines?\\b", "")
                    .replaceAll("\\s{2,}", " ").trim();
            f.put("description", description + " The bow is a small raised 3D bow charm made of smooth glossy milky resin"
                    + " with visible thickness and plump smooth loops (a real molded charm, not a drawing or line-art).");
            System.out.println("[FingerDesignPlan] 드로잉 리본 불허 → " + finger + " 손톱의 리본을 3D 리본 참으로 변환");
        }
    }

    // 니트(벨벳)젤: 컬러 안에 섬유 조각이 들어간 색 표현. 잉크: 맑은 젤에 잉크를 푼 듯한 색 표현(드로잉 배경/체크).
    private static final java.util.regex.Pattern KNIT_WORDS = java.util.regex.Pattern.compile("knit|니트|velvet|벨벳");
    private static final java.util.regex.Pattern INK_WORDS = java.util.regex.Pattern.compile("\\bink\\b|잉크|drawing|드로잉");
    private static final java.util.regex.Pattern AUTUMN_WINTER = java.util.regex.Pattern.compile(
            "autumn|\\bfall\\b|winter|가을|겨울|christmas|크리스마스");
    private static final java.util.regex.Pattern CHECK_WORDS = java.util.regex.Pattern.compile("체크|\\bcheck|plaid|gingham|깅엄");
    private static final java.util.regex.Pattern BLOOMING_WORDS = java.util.regex.Pattern.compile("블루밍|blooming");
    private static final java.util.regex.Pattern FUNKY_CHIC = java.util.regex.Pattern.compile("funky|펑키|chic|시크");
    private static final java.util.regex.Pattern FUNKY_WORDS = java.util.regex.Pattern.compile("funky|펑키");
    private static final List<String> EXPRESSION_DESIGNS = List.of("glitter", "magnetic", "knit", "ink");

    private static boolean wantsKnit(String wanted) {
        return KNIT_WORDS.matcher(wanted).find();
    }

    private static boolean wantsInk(String wanted) {
        return INK_WORDS.matcher(wanted).find();
    }

    private static final java.util.regex.Pattern DOT_WORD = java.util.regex.Pattern.compile("(?i)\\bdots?\\b");
    private static final java.util.regex.Pattern DOT_CONJ = java.util.regex.Pattern.compile("(?i)\\b(?:with|and|plus|featuring)\\b");
    private static final java.util.regex.Pattern DOT_PHRASE = java.util.regex.Pattern.compile(
            "(?i)\\s*\\b(?:(?:tiny|small|mini|little|dainty|scattered|polka)\\s+){0,2}dots?\\b"
                    + "(?:\\s+(?:scattered\\s+)?(?:near|around|along|beside|across|on|at|over|between)\\b[^,.;]*)?");

    /** 설명에서 도트 문구만 지운다: 같은 절에 "with/and ..."가 있으면 그 접속어부터 절 끝까지, 없으면 도트 구만 지운다. */
    private static String dropDotWording(String description) {
        StringBuilder out = new StringBuilder();
        int sentenceNo = 0;
        for (String sentence : description.split("(?<=[.!?])\\s+")) {
            sentenceNo++;
            java.util.regex.Matcher m = DOT_WORD.matcher(sentence);
            String s = sentence;
            if (m.find()) {
                int idx = m.start();
                int clauseStart = Math.max(sentence.lastIndexOf(',', idx), sentence.lastIndexOf(';', idx)) + 1;
                int clauseEnd = sentence.length();
                for (int i = m.end(); i < sentence.length(); i++) {
                    char c = sentence.charAt(i);
                    if (c == ',' || c == ';') { clauseEnd = i; break; }
                }
                java.util.regex.Matcher conj = DOT_CONJ.matcher(sentence.substring(clauseStart, idx));
                int cut = -1;
                while (conj.find()) cut = clauseStart + conj.start();
                if (cut >= 0) {
                    String tail = sentence.substring(clauseEnd);
                    String endPunct = (clauseEnd >= sentence.length() && (sentence.endsWith(".") || sentence.endsWith("!")))
                            ? sentence.substring(sentence.length() - 1) : "";
                    s = sentence.substring(0, cut).stripTrailing() + (clauseEnd < sentence.length() ? tail : endPunct);
                } else if (sentenceNo > 1) {
                    s = ""; // 첫 문장(베이스 설명)이 아닌 도트 문장은 통째로 지운다
                } else {
                    s = DOT_PHRASE.matcher(sentence).replaceAll("");
                }
            }
            if (!s.isBlank() && !s.equals(".")) {
                if (out.length() > 0) out.append(" ");
                out.append(s);
            }
        }
        return out.toString().replaceAll("\\s{2,}", " ").replaceAll("\\s+([,.;])", "$1")
                .replaceAll("[,;]+(?=\\s*[.!?]?$)", "").trim();
    }

    /**
     * 도트는 손톱 전체를 차지하는 단독 디자인이거나 프렌치 팁 영역에만 들어간다. 모티프/파츠(체리, 꽃, 리본 ...)가 있는 손톱에
     * 도트가 같이 뿌려지면(체리 주변에 도트) 도트 패턴과 설명의 도트 문구를 지운다. 캐릭터(점 눈)와 블루밍(번지는 점)은 대상이 아니고,
     * 사용자가 도트를 직접 말했다면 건드리지 않는다.
     */
    /**
     * 펑키/시크 무드를 골랐는데 블루밍(번지는 점) 손톱이 하나도 없으면, 패턴/모티프/파츠가 없는 손톱 최대 2개에 블루밍을 넣는다.
     * 블루밍은 디자인 타입 선택지에 없어서 무드로 켠다. 블루밍을 피해야 한다고 골랐으면 건드리지 않는다.
     */
    private void enforceBloomingForMood(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        String w = wantedPart(confirmedInput);
        if (!FUNKY_CHIC.matcher(w).find()) return;
        String avoided = java.util.Arrays.stream((confirmedInput == null ? "" : confirmedInput.toLowerCase()).split("\\R"))
                .filter(line -> line.contains("피해야 함")).collect(java.util.stream.Collectors.joining("\n"));
        if (BLOOMING_WORDS.matcher(avoided).find()) return;
        for (String finger : FINGERS) {
            if (arrayContains(root.path(finger).path("pattern"), "blooming")) return;
        }
        int added = 0;
        for (String finger : FINGERS) {
            if (added >= 2) break;
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            boolean empty = (!f.path("pattern").isArray() || f.path("pattern").size() == 0)
                    && (!f.path("motif").isArray() || f.path("motif").size() == 0)
                    && (!f.path("parts").isArray() || f.path("parts").size() == 0)
                    && !arrayContains(f.path("finish"), "glitter") && !arrayContains(f.path("finish"), "magnetic cat eye")
                    && !arrayContains(f.path("finish"), "powder finish");
            if (!empty) continue;
            addToArray(f, "pattern", "blooming");
            f.put("description", f.path("description").asText("")
                    + " Big soft filled blooming dots in a deeper tone of the base, darkest in the center and fading outward, form"
                    + " a scalloped row along the curved free edge of the sheer base.");
            added++;
        }
        if (added == 0) {
            // 비어 있는 손톱이 없으면(사용자가 디자인을 여럿 골라 다섯 손톱이 찼을 때) 모티프도 색 효과(글리터/자석/파우더)도 없는
            // 손톱 중 파츠가 가장 적은 손톱 하나의 패턴을 블루밍으로 바꾼다.
            ObjectNode best = null;
            int bestParts = Integer.MAX_VALUE;
            for (String finger : FINGERS) {
                if (!(root.path(finger) instanceof ObjectNode f)) continue;
                boolean hasMotif = false;
                for (JsonNode m : f.path("motif")) {
                    String v = m.asText("").trim().toLowerCase();
                    if (!v.isEmpty() && !v.equals("none")) hasMotif = true;
                }
                boolean effect = arrayContains(f.path("finish"), "glitter") || arrayContains(f.path("finish"), "magnetic cat eye")
                        || arrayContains(f.path("finish"), "powder finish") || arrayContains(f.path("finish"), "ink")
                        || arrayContains(f.path("finish"), "knit");
                if (hasMotif || effect) continue;
                int parts = f.path("parts").isArray() ? f.path("parts").size() : 0;
                if (parts < bestParts) { best = f; bestParts = parts; }
            }
            if (best != null) {
                best.set("pattern", best.arrayNode().add("blooming"));
                best.put("description", best.path("description").asText("")
                        + " The nail's base design is blooming: soft filled dots in a deeper tone of the base, darkest in the center"
                        + " and fading outward, forming a scalloped row along the curved free edge of the sheer base, replacing any"
                        + " other base pattern.");
                added = 1;
            }
        }
        if (added > 0) System.out.println("[FingerDesignPlan] 펑키/시크 무드 → 손톱 " + added + "개에 블루밍을 적용");
        else System.err.println("[FingerDesignPlan] ⚠ 펑키/시크 무드지만 블루밍을 넣을 손톱이 없습니다.");
    }

    private static final java.util.regex.Pattern HAND_CHECK_OK = java.util.regex.Pattern.compile(
            "drawing|드로잉|cute|큐트|귀여");

    /**
     * 드로잉 + 체크 또는 큐트 + 체크 조합이면 체크 손톱(글리터로 그린 체크 제외)에 손으로 그은 듯한 삐뚤빼뚤한 얇은 선을 같이 그린다.
     * 플래너가 그 문구를 안 썼으면 설명에 덧붙인다(이미지 프롬프트가 이 문구를 보고 선 문장을 붙인다).
     */
    private void enforceHandDrawnCheck(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        String w = wantedPart(confirmedInput);
        if (!(CHECK_WORDS.matcher(w).find() && HAND_CHECK_OK.matcher(w).find())) return;
        int n = 0;
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            if (!arrayContains(f.path("pattern"), "plaid")) continue;
            String description = f.path("description").asText("");
            if (!description.toLowerCase().contains("wobbly")) {
                f.put("description", description + " The check has hand-drawn wobbly check lines over the color bands.");
            }
            n++;
        }
        if (n > 0) System.out.println("[FingerDesignPlan] 드로잉/큐트 + 체크 → 체크 손톱 " + n + "개에 손으로 그은 삐뚤빼뚤한 선을 추가");
    }

    private static boolean isDotValue(String raw) {
        String v = raw == null ? "" : raw.trim().toLowerCase();
        return v.equals("dot") || v.equals("dots") || v.startsWith("polka") || v.equals("도트");
    }

    private void enforceDotRules(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        String wanted = wantedPart(confirmedInput);
        boolean wantsDots = wanted.contains("dot") || wanted.contains("도트");
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            // 1) motif 칸에 들어온 도트(핵심 요소 "도트")는 패턴으로 옮긴다 - 도트는 모티프가 아니라 손톱 전체/프렌치 팁 디자인이다.
            boolean movedDot = false;
            com.fasterxml.jackson.databind.node.ArrayNode kept = f.arrayNode();
            for (JsonNode m : f.path("motif")) {
                if (isDotValue(m.asText(""))) movedDot = true;
                else kept.add(m.asText(""));
            }
            if (movedDot) {
                f.set("motif", kept);
                if (!arrayContains(f.path("pattern"), "polka dot")
                        && (!f.path("pattern").isArray() || f.path("pattern").size() == 0)) {
                    addToArray(f, "pattern", "polka dot");
                }
            }
            String motifs = f.path("motif").toString().toLowerCase();
            boolean hasMotif = false;
            for (JsonNode m : f.path("motif")) {
                String v = m.asText("").trim().toLowerCase();
                if (!v.isEmpty() && !v.equals("none")) hasMotif = true;
            }
            boolean hasParts = f.path("parts").isArray() && f.path("parts").size() > 0;
            // 도트가 모티프 칸에서 넘어왔는데 이 손톱에 이미 다른 패턴(그라데이션 등)이 있으면 도트를 섞지 않고 지운다.
            boolean otherPattern = movedDot && f.path("pattern").isArray() && f.path("pattern").size() > 0
                    && !arrayContains(f.path("pattern"), "polka dot") && !arrayContains(f.path("pattern"), "french tip");
            if (!(hasMotif || hasParts || otherPattern)) continue;
            if (motifs.contains("character") || arrayContains(f.path("pattern"), "watercolor")
                    || arrayContains(f.path("pattern"), "blooming")) continue;
            // 프렌치 팁 손톱은 팁 영역 안의 도트가 허용된다.
            if (arrayContains(f.path("pattern"), "french tip")) continue;
            // 2) 다른 모티프/파츠가 있는 손톱에는 도트를 섞지 않는다(체리 주변 도트 등).
            boolean changed = false;
            if (arrayContains(f.path("pattern"), "polka dot")) {
                removeFromArray(f, "pattern", "polka dot");
                changed = true;
            }
            String description = f.path("description").asText("");
            String cleaned = dropDotWording(description);
            if (!cleaned.equals(description.trim()) && !cleaned.isEmpty()) {
                f.put("description", cleaned);
                changed = true;
            }
            if (changed) System.out.println("[FingerDesignPlan] 도트 규칙: " + finger + " 손톱의 도트(모티프/파츠와 혼합)를 제거");
        }
        // 3) 사용자가 도트를 골랐는데 도트 손톱이 하나도 없으면, 비어 있는 손톱 두 개에 손톱 전체 도트를 넣는다.
        if (wantsDots) {
            boolean any = false;
            for (String finger : FINGERS) if (arrayContains(root.path(finger).path("pattern"), "polka dot")) any = true;
            if (!any) {
                int added = 0;
                for (String finger : FINGERS) {
                    if (added >= 2) break;
                    if (!(root.path(finger) instanceof ObjectNode f)) continue;
                    boolean empty = (!f.path("pattern").isArray() || f.path("pattern").size() == 0)
                            && (!f.path("motif").isArray() || f.path("motif").size() == 0)
                            && (!f.path("parts").isArray() || f.path("parts").size() == 0);
                    if (!empty) continue;
                    addToArray(f, "pattern", "polka dot");
                    f.put("description", f.path("description").asText("")
                            + " Evenly spaced solid round dots of one size cover the whole nail.");
                    added++;
                }
                if (added > 0) System.out.println("[FingerDesignPlan] 도트 요청 → 비어 있던 손톱 " + added + "개에 손톱 전체 도트를 추가");
            }
        }
    }

    /** 선택한 designType 값을 내부 디자인 이름으로 바꾼다. 매트/드로잉/자유 입력처럼 "디자인"이 아닌 값은 null. */
    private static String canonicalDesign(String raw) {
        String v = raw == null ? "" : raw.toLowerCase().trim();
        if (v.contains("glitter") || v.contains("글리터") || v.contains("반짝")) return "glitter";
        if (v.contains("gradient") || v.contains("그라데")) return "gradient";
        if (v.contains("cheek") || v.contains("치크") || v.contains("블러시")) return "cheek";
        if (v.contains("marble") || v.contains("마블")) return "marble";
        if (v.contains("french") || v.contains("프렌치")) return "french";
        if (v.contains("magnetic") || v.contains("마그네틱") || v.contains("자석") || v.contains("cat eye")
                || v.contains("캣아이")) return "magnetic";
        if (v.contains("powder") || v.contains("파우더") || v.contains("오로라")) return "powder";
        if (KNIT_WORDS.matcher(v).find()) return "knit";
        if (INK_WORDS.matcher(v).find()) return "ink";
        if (CHECK_WORDS.matcher(v).find()) return "check";
        if (BLOOMING_WORDS.matcher(v).find()) return "blooming";
        return null;
    }

    private static String describeDesign(String design, String base) {
        boolean syrup = "syrup".equals(base);
        return switch (design) {
            case "glitter" -> syrup
                    ? "glitter nail: finish jelly + glitter - ultra-fine glitter floating inside a syrup base, no base pattern"
                    : "glitter nail: finish glitter on a solid base, no base pattern";
            case "magnetic" -> "magnetic nail: finish magnetic cat eye, no base pattern";
            case "powder" -> syrup
                    ? "powder nail: finish jelly + powder finish - pearl-powder glaze over a syrup base, no base pattern"
                    : "powder nail: finish powder finish on a solid base, no base pattern";
            case "gradient" -> "gradient nail: pattern gradient on a " + base + " base";
            case "marble" -> "marble nail: pattern marble on a " + base + " base";
            case "french" -> "french tip nail: pattern french tip on a " + base + " base";
            case "cheek" -> "cheek blush nail: pattern cheek blush on a syrup base";
            case "knit" -> "knit nail: finish knit - a translucent glossy knit gel one-color nail with thin hair-like fibers"
                    + " floating inside the gel (not a woven fabric look), no glitter, no base pattern";
            case "blooming" -> "blooming nail: pattern blooming - soft filled ink-drop dots (dark center fading outward, deeper tone of the base) in a scalloped row along the nail's free edge on a " + base + " base";
            case "check" -> "check nail: pattern plaid - a gingham check on a " + base + " base (when ink is part of the set it is an"
                    + " ink check: finish jelly + ink)";
            case "ink" -> "ink nail: finish jelly + ink - a syrup base color with ink on top: a hand-drawn motif filled with"
                    + " sheer saturated transparent ink colors, or ink dots (whole-nail solid dots), or an ink check";
            default -> "one-color nail: plain " + base + ", no base pattern, no color effect";
        };
    }

    /**
     * 기본 구성: 세 가지 디자인이 번갈아 나오는 세트(디자인 둘은 손톱 2개씩, 하나는 1개 - 예: A B A C B).
     * 사용자가 고른 디자인 타입(designType)은 그 세 가지 안에 들어가고, 모자란 만큼은 어울리는 디자인으로 채운다.
     * 한 가지만 골라도 세트 전체가 그것으로 덮이지 않는다. 손가락 지정 / "모든 손톱" / "글리터만" 같은 명시가 있으면
     * 계획을 만들지 않는다(그 요청을 그대로 따른다).
     */
    private String buildThreeDesignPlan(String confirmedInput) {
        String input = confirmedInput == null ? "" : confirmedInput;
        if (input.contains(FINGER_ASSIGNMENT_MARK) || ALL_NAILS_OR_ONLY.matcher(input).find()) return "";
        java.util.concurrent.ThreadLocalRandom r = java.util.concurrent.ThreadLocalRandom.current();

        List<String> picked = new java.util.ArrayList<>();
        boolean matte = false;
        java.util.regex.Matcher selected = DESIGN_TYPE_LINE.matcher(input);
        if (selected.find()) {
            for (String raw : selected.group(1).split(",")) {
                if (raw.toLowerCase().contains("matte") || raw.contains("매트")) matte = true;
                String design = canonicalDesign(raw);
                if (design != null && !picked.contains(design)) picked.add(design);
            }
        }
        java.util.Set<String> avoided = new java.util.HashSet<>();
        java.util.regex.Matcher avoidedLine = DESIGN_TYPE_AVOID_LINE.matcher(input);
        if (avoidedLine.find()) {
            for (String raw : avoidedLine.group(1).split(",")) {
                String design = canonicalDesign(raw);
                if (design != null) avoided.add(design);
            }
        }
        // 매트 세트는 전부 솔리드라 글리터/파우더/치크가 없다(자석도 매트에는 쓰지 않는다).
        if (matte) picked.removeIf(d -> List.of("glitter", "powder", "magnetic", "cheek", "ink").contains(d));
        // 블루밍은 디자인 타입 선택지에 없어서 펑키/시크 무드를 고르면 세트에 넣는다(사용자가 세 가지를 다 골랐으면 네 번째 디자인).
        if (FUNKY_CHIC.matcher(wantedPart(input)).find() && !avoided.contains("blooming")
                && !picked.contains("blooming") && picked.size() < 4) {
            picked.add("blooming");
        }
        // 모자란 디자인은 원컬러/그라데이션을 가장 자주(일반적인 세트), 글리터는 가끔, 나머지는 드물게 채운다.
        List<String> pool = new java.util.ArrayList<>(List.of(DESIGN_ONE_COLOR, DESIGN_ONE_COLOR, DESIGN_ONE_COLOR,
                DESIGN_ONE_COLOR, DESIGN_ONE_COLOR, "gradient", "gradient", "gradient", "gradient", "gradient",
                "glitter", "glitter", "marble", "french", "cheek", "powder"));
        pool.removeIf(d -> picked.contains(d) || avoided.contains(d));
        boolean wantsOpaque = WANTS_OPAQUE.matcher(wantedPart(input)).find();
        if (matte) pool.removeIf(d -> List.of("glitter", "powder", "cheek").contains(d));
        // 사용자가 솔리드/불투명을 원하면 시럽 전용인 치크는 보완 디자인으로 채우지 않는다.
        if (wantsOpaque) pool.removeIf(d -> d.equals("cheek"));
        // 니트는 가을/겨울 세트에서 가끔 채운다(항상은 아님 - 사용자가 직접 고르지 않으면 드물게).
        if (AUTUMN_WINTER.matcher(wantedPart(input)).find()) { pool.add("knit"); pool.add("knit"); }
        // 블루밍은 펑키/시크 계열에서 자주 쓴다 - 그 무드일 때 가끔 채운다.
        if (FUNKY_CHIC.matcher(wantedPart(input)).find()) { pool.add("blooming"); pool.add("blooming"); }
        // 색 효과(글리터/자석/니트/잉크)는 세트당 하나만 채운다 - 색 표현은 두 종류까지.
        if (picked.stream().anyMatch(EXPRESSION_DESIGNS::contains)) pool.removeIf(EXPRESSION_DESIGNS::contains);
        java.util.Collections.shuffle(pool, r);

        List<String> designs = new java.util.ArrayList<>(picked);
        for (String d : pool) {
            if (designs.size() >= 3) break;
            if (designs.contains(d)) continue;
            if (EXPRESSION_DESIGNS.contains(d) && designs.stream().anyMatch(EXPRESSION_DESIGNS::contains)) continue;
            designs.add(d);
        }
        if (designs.size() < 3 && !designs.contains(DESIGN_ONE_COLOR) && !avoided.contains(DESIGN_ONE_COLOR)) designs.add(DESIGN_ONE_COLOR);
        if (designs.size() > 5) designs = new java.util.ArrayList<>(designs.subList(0, 5));
        if (designs.size() < 2) return "";

        // 손톱 수: 셋이면 2/2/1 (사용자가 고르지 않은, 채운 디자인이 1개를 맡는다), 넷이면 2/1/1/1, 다섯이면 1씩.
        int n = designs.size();
        int[] counts = new int[n];
        if (n == 2) { counts[0] = 3; counts[1] = 2; }
        else if (n == 3) {
            int single = picked.size() < 3 ? 2 : r.nextInt(3);
            for (int i = 0; i < 3; i++) counts[i] = i == single ? 1 : 2;
        } else if (n == 4) { counts[0] = 2; counts[1] = counts[2] = counts[3] = 1; }
        else java.util.Arrays.fill(counts, 1);

        List<Integer> seq = new java.util.ArrayList<>();
        for (int i = 0; i < n; i++) for (int k = 0; k < counts[i]; k++) seq.add(i);
        boolean alternating = false;
        for (int attempt = 0; attempt < 300 && !alternating; attempt++) {
            java.util.Collections.shuffle(seq, r);
            alternating = true;
            for (int i = 1; i < seq.size(); i++) {
                if (seq.get(i).equals(seq.get(i - 1))) { alternating = false; break; }
            }
        }
        if (!alternating) {
            seq.clear();
            for (int i = 0; i < 5; i++) seq.add(i % n);
        }

        // 컬러 표현은 기본이 시럽(반투명 젤)이다. 매트 세트이거나 사용자가 솔리드/불투명을 원한다고 했을 때만 솔리드
        // (치크는 시럽 전용이라 치크가 있으면 항상 시럽).
        String base = designs.contains("cheek") ? "syrup" : ((matte || wantsOpaque) ? "solid" : "syrup");
        char[] labels = {'A', 'B', 'C', 'D', 'E'};
        StringBuilder sb = new StringBuilder("\n[THREE-DESIGN PLAN] Default composition for this request (follow it unless the user"
                + " assigned fingers or asked for a design on all nails): ");
        for (int i = 0; i < FINGERS.size(); i++) {
            int d = seq.get(i);
            sb.append(FINGERS.get(i)).append(" = design ").append(labels[d]).append(" (")
                    .append(describeDesign(designs.get(d), base)).append(")");
            if (i < FINGERS.size() - 1) sb.append("; ");
        }
        sb.append(". Nails that share a design differ in a visible accent. ");
        if (matte) sb.append("The whole set is matte (all solid). ");
        sb.append("Base color expression for every non-effect nail: ").append(base).append(".\n");
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
        if (arrayContains(finger.path("finish"), "knit")) return "knit";
        if (arrayContains(finger.path("finish"), "jelly")) return "jelly";
        if (arrayContains(finger.path("finish"), "ink")) return "ink";
        if (arrayContains(finger.path("finish"), "magnetic cat eye")) return "magnetic";
        if (arrayContains(finger.path("finish"), "glitter")) return "glitter";
        if (arrayContains(finger.path("finish"), "chrome")) return "chrome";
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
    private void limitColorExpressions(JsonNode plan, String wantedInput) {
        java.util.Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        boolean cheekExists = false;
        for (String finger : FINGERS) {
            JsonNode f = plan.path(finger);
            if (f.isMissingNode()) continue;
            counts.merge(colorType(f), 1, Integer::sum);
            if (arrayContains(f.path("pattern"), "cheek blush")) cheekExists = true;
        }
        counts.remove("chrome"); // 크롬 손톱은 상한에 세지 않고, 아래에서도 바꾸지 않는다
        if (counts.size() <= 2) return;
        // 시럽(jelly)은 기본 베이스라 항상 남기고, 그 외 색 표현(자석/글리터/니트/잉크)은 한 가지만 남긴다(솔리드가 이미 있으면 0).
        // 사용자가 고른 표현은 손톱 수가 적어도 남긴다 - 안 그러면 고른 효과가 후처리로 지워진다(둘 다 골랐으면 둘 다).
        List<String> keep = new ArrayList<>();
        if (counts.containsKey("glitter") && wantsGlitter(wantedInput)) keep.add("glitter");
        if (counts.containsKey("magnetic") && wantsMagnetic(wantedInput)) keep.add("magnetic");
        if (counts.containsKey("knit") && wantsKnit(wantedInput)) keep.add("knit");
        if (counts.containsKey("ink") && wantsInk(wantedInput)) keep.add("ink");
        if (keep.size() > 2) keep = new ArrayList<>(keep.subList(0, 2));
        if (keep.isEmpty() && !counts.containsKey("solid")) {
            String best = null;
            for (String t : List.of("magnetic", "glitter", "knit", "ink")) {
                if (counts.containsKey(t) && (best == null || counts.get(t) > counts.get(best))) best = t;
            }
            if (best != null) keep.add(best);
        }
        keep.add("jelly");
        for (String finger : FINGERS) {
            if (!(plan.path(finger) instanceof ObjectNode f)) continue;
            String type = colorType(f);
            if ("solid".equals(type) || "chrome".equals(type) || keep.contains(type)) continue;
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
                case "knit" -> {
                    removeFromArray(f, "finish", "knit");
                    description = dropWording(description, KNIT_WORDING);
                }
                case "ink" -> {
                    removeFromArray(f, "finish", "ink");
                    description = dropWording(description, INK_WORDING);
                }
                default -> { }
            }
            f.put("description", description);
        }
    }

    // 섬유 조각 문구는 지우고(색 설명은 남긴다), 니트/잉크 이름은 일반 젤 표현으로 바꾼다.
    private static final java.util.regex.Pattern KNIT_FIBER_WORDING = java.util.regex.Pattern.compile(
            "(?i)\\s*(?:,|with|and)?\\s*(?:a few |some |countless )?(?:(?:short|fine|subtle)\\s+)*fibre?s?(?:\\s+flecks?)?"
                    + "|\\s*(?:,|with|and)?\\s*(?:a few |some |countless )?(?:(?:short|fine|subtle)\\s+)*fibers?(?:\\s+flecks?)?");
    private static final java.util.regex.Pattern KNIT_WORDING = java.util.regex.Pattern.compile(
            "(?i)\\b(?:knit(?:ted)?|velvet|wool(?:en)?)\\b(?:\\s+(?:velvet|gel|finish|texture|effect))*");
    private static final java.util.regex.Pattern INK_WORDING = java.util.regex.Pattern.compile(
            "(?i)\\bink\\b(?:\\s+(?:wash|gel|check))*(?:\\s+on\\s+clear\\s+gel)?");

    private static String dropWording(String description, java.util.regex.Pattern wording) {
        String d = description;
        if (wording == KNIT_WORDING) d = KNIT_FIBER_WORDING.matcher(d).replaceAll("");
        return wording.matcher(d).replaceAll(wording == KNIT_WORDING ? "solid gel" : "gel")
                .replaceAll("\\s{2,}", " ").trim();
    }

    private static final java.util.regex.Pattern SYRUP_WORDING = java.util.regex.Pattern.compile("(?i)syrup|jelly|translucent");

    private static final String SYRUP_SENTENCE =
            " The base color is a translucent syrup gel: pigment suspended in clear glassy jelly with the nail bed"
                    + " color glowing softly through it.";

    /**
     * 컬러 표현의 기본값은 시럽(반투명 젤)이다. 불투명한 파스텔은 납작하고 싸구려처럼 나와서(밤티), 사용자가
     * 솔리드/불투명/매트를 말하지 않았다면 모든 손톱의 베이스를 시럽으로 맞춘다: finish에 "jelly"를 넣고 설명도 시럽 표현으로
     * 보정한다. 글리터/파우더/프렌치 손톱도 시럽 베이스 위에 얹는다. 자석젤/크롬 손톱은 그 효과가 색 표현이라 그대로 둔다.
     * (GPT가 솔리드로 쓴 손톱이 남아 있으면 프롬프트 지시만으로는 기본값이 지켜지지 않아서 코드로도 맞춘다.)
     */
    private void ensureSyrupDefault(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        if (root.path("surface").asText("").toLowerCase().contains("matte")) return;
        if (WANTS_OPAQUE.matcher(wantedPart(confirmedInput)).find()) return;
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            if (arrayContains(f.path("finish"), "jelly") || arrayContains(f.path("finish"), "magnetic cat eye")
                    || arrayContains(f.path("finish"), "chrome") || arrayContains(f.path("finish"), "knit")) continue;
            addToArray(f, "finish", "jelly");
            String description = f.path("description").asText("");
            // 베이스를 가리키는 "opaque"/"solid"만 시럽 표현으로 바꾼다("solid white ribbon" 같은 장식 묘사는 건드리지 않도록
            // base/color/gel/polish 근처의 solid만).
            description = description.replaceAll("(?i)\\bopaque\\s+solid\\b", "translucent syrup")
                    .replaceAll("(?i)\\bsolid\\b(?=[^.]{0,40}\\b(?:base|color|colour|gel|polish)\\b)", "syrup")
                    .replaceAll("(?i)\\bopaque\\b", "translucent");
            if (!SYRUP_WORDING.matcher(description).find()) description = description + SYRUP_SENTENCE;
            if (!description.isEmpty() && Character.isLowerCase(description.charAt(0))) {
                description = Character.toUpperCase(description.charAt(0)) + description.substring(1);
            }
            f.put("description", description);
        }
    }

    /** "(피해야 함)" 줄을 뺀, 사용자가 원한다고 말한 내용만. */
    private static String wantedPart(String confirmedInput) {
        return confirmedInput == null ? "" : confirmedInput.toLowerCase().replaceAll("(?m)^.*피해야 함.*$", "");
    }

    private static boolean wantsGlitter(String wanted) {
        return wanted.contains("glitter") || wanted.contains("글리터") || wanted.contains("반짝");
    }

    private static boolean wantsMagnetic(String wanted) {
        return wanted.contains("magnetic") || wanted.contains("마그네틱") || wanted.contains("자석");
    }

    /**
     * 조합 규칙을 코드로 강제한다 (프롬프트 지시만으로는 GPT가 가끔 어김):
     * - 치크 블러시는 시럽(jelly)에서만: 글리터/자석/크롬 제거, jelly 보장
     * - 글리터는 최대 2개 손톱. 글리터를 골랐다고 모든 손톱에 깔면 "글리터만 있는 세트"가 되므로, 기본 구성(세 가지 디자인이
     *   번갈아 나오는 세트)에서는 사용자가 골라도 2개까지다. 손가락을 직접 지정했거나 "모든 손톱"/"글리터만"처럼 명시한 경우만
     *   상한을 푼다. 글리터가 허용되지 않는 손톱의 글리터 문장은 정리한다.
     */
    private void enforceCombinationRules(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode)) return;
        String userInput = wantedPart(confirmedInput);
        boolean userAskedGlitter = wantsGlitter(userInput);
        boolean glitterUncapped = confirmedInput != null
                && (confirmedInput.contains(FINGER_ASSIGNMENT_MARK) || ALL_NAILS_OR_ONLY.matcher(confirmedInput).find());
        // 글리터를 "피해야 함"으로 골랐는데 플래너가 넣었다면 전부 뺀다 (원한다는 말이 따로 없을 때).
        String avoidedLines = java.util.Arrays.stream((confirmedInput == null ? "" : confirmedInput.toLowerCase()).split("\\R"))
                .filter(line -> line.contains("피해야 함")).collect(java.util.stream.Collectors.joining("\n"));
        boolean glitterAvoided = !userAskedGlitter && wantsGlitter(avoidedLines);
        int glitterNails = 0;
        boolean matteSet = plan.path("surface").asText("").toLowerCase().contains("matte");
        for (String finger : FINGERS) {
            if (!(plan.path(finger) instanceof ObjectNode f)) continue;
            // 잉크는 광택 전용(매트 세트에는 쓰지 않는다). 니트는 시럽/글리터/자석/파우더와 섞지 않는다.
            if (matteSet) removeFromArray(f, "finish", "ink");
            if (arrayContains(f.path("finish"), "knit")) {
                removeFromArray(f, "finish", "glitter");
                removeFromArray(f, "finish", "magnetic cat eye");
                removeFromArray(f, "finish", "powder finish");
            }
            boolean cheek = arrayContains(f.path("pattern"), "cheek blush");
            boolean glitter = arrayContains(f.path("finish"), "glitter");
            if (cheek) {
                removeFromArray(f, "finish", "glitter");
                removeFromArray(f, "finish", "magnetic cat eye");
                removeFromArray(f, "finish", "chrome");
                removeFromArray(f, "finish", "knit");
                removeFromArray(f, "finish", "ink");
                if (!arrayContains(f.path("finish"), "jelly")) addToArray(f, "finish", "jelly");
                glitter = false;
            }
            if (glitter && glitterAvoided) {
                removeFromArray(f, "finish", "glitter");
                glitter = false;
            }
            if (glitter) {
                glitterNails++;
                if (!glitterUncapped && glitterNails > 2) {
                    removeFromArray(f, "finish", "glitter");
                    glitter = false;
                }
            }
            String description = f.path("description").asText("");
            // 글리터가 없는 손톱의 설명에 글리터 표현이 남아 있으면 이미지 모델이 그 손톱에도 글리터를 칠한다.
            if (!glitter && (cheek || !glitterUncapped || !userAskedGlitter) && description.toLowerCase().contains("glitter")) {
                description = dropGlitterWording(description);
            }
            if (cheek) {
                // 치크는 시럽 전용이라 불투명/솔리드 표현이 남아 있으면 시럽 표현으로 바꾼다.
                description = description.replaceAll("(?i)\\bopaque\\b", "translucent").replaceAll("(?i)\\bsolid\\b", "syrup");
            }
            f.put("description", description);
        }
        ensureSyrupDefault(plan, confirmedInput);
        limitColorExpressions(plan, userInput);
    }

    /**
     * 손톱별 디자인(색 효과 + 패턴, 없으면 one-color)을 한 줄로 남긴다. 세 가지 디자인이 번갈아 나오는 세트가 됐는지
     * (예: glitter / gradient / glitter / one-color / gradient) 로그로 바로 확인하기 위한 것이다. 한 디자인이 세 손톱
     * 이상에 쓰였는데 사용자가 손가락을 지정하거나 "모든 손톱"/"글리터만"처럼 명시한 것도 아니면 경고를 낸다.
     */
    private void logSetComposition(JsonNode plan, String confirmedInput) {
        List<String> tags = new ArrayList<>();
        for (String finger : FINGERS) {
            JsonNode f = plan.path(finger);
            List<String> parts = new ArrayList<>();
            if (arrayContains(f.path("finish"), "glitter")) parts.add("glitter");
            if (arrayContains(f.path("finish"), "magnetic cat eye")) parts.add("magnetic");
            if (arrayContains(f.path("finish"), "powder finish")) parts.add("powder");
            if (arrayContains(f.path("finish"), "knit")) parts.add("knit");
            if (arrayContains(f.path("finish"), "ink")) parts.add("ink");
            for (JsonNode p : f.path("pattern")) parts.add(p.asText(""));
            tags.add(parts.isEmpty() ? DESIGN_ONE_COLOR : String.join("+", parts));
        }
        System.out.println("[FingerDesignPlan] 손톱별 구성(엄지→새끼): " + String.join(" / ", tags));
        // 컬러 표현 집계: 기본은 시럽이라 solid가 남아 있으면 사용자가 솔리드/매트를 원했거나 기본값 적용에 실패한 것이다.
        java.util.Map<String, Integer> expressions = new java.util.LinkedHashMap<>();
        for (String finger : FINGERS) expressions.merge(colorType(plan.path(finger)), 1, Integer::sum);
        System.out.println("[FingerDesignPlan] 컬러 표현(jelly=시럽): " + expressions);

        // 리본은 세트 안에서 한 가지 룩(3D면 전부 3D, 드로잉이면 전부 드로잉)이어야 한다 - 섞이면 경고만 남긴다.
        int raisedBows = 0, flatBows = 0;
        for (String finger : FINGERS) {
            JsonNode f = plan.path(finger);
            if (arrayContains(f.path("parts"), "bow charm 3d")) raisedBows++;
            else if (arrayContains(f.path("motif"), "bow ribbon")
                    && !arrayContains(f.path("finish"), "sculpted 3d")) flatBows++;
        }
        if (raisedBows > 0 && flatBows > 0) {
            System.err.println("[FingerDesignPlan] ⚠ 리본이 3D(" + raisedBows + "개)와 드로잉(" + flatBows
                    + "개)으로 섞여 있습니다 - 한 세트에는 한 가지 리본 룩만 써야 합니다.");
        }

        boolean explicit = confirmedInput != null
                && (confirmedInput.contains(FINGER_ASSIGNMENT_MARK) || ALL_NAILS_OR_ONLY.matcher(confirmedInput).find());
        java.util.Map<String, Integer> counts = new java.util.LinkedHashMap<>();
        for (String tag : tags) counts.merge(tag, 1, Integer::sum);
        counts.forEach((tag, count) -> {
            if (count > 2 && !explicit) {
                System.err.println("[FingerDesignPlan] ⚠ 같은 디자인(" + tag + ")이 손톱 " + count
                        + "개에 쓰였습니다 - 세 가지 디자인이 번갈아 나오는 구성이 아닙니다.");
            }
        });
    }

    // ── 원컬러(단색) 세트 ────────────────────────────────────────────────────

    private static final List<String> UNIFORM_KEYWORDS = List.of(
            "원컬러", "원 컬러", "one color", "one-color", "onecolor", "single color", "single-color",
            "한 가지 색", "한가지 색", "한 가지 컬러", "한가지 컬러", "단색");

    private static final String UNIFORM_SET_SECTION = """

            [ONE-COLOR SET - HIGHEST PRIORITY, OVERRIDES EVERY RULE ABOVE]
            The user asked for a one-color set. All five nails are the SAME single color and the SAME
            color expression (all syrup, or all solid), with the same finish and gloss. No nail has any
            base design / pattern, motif, part, powder, glitter, magnetic, french tip, cheek blush, gradient
            or marble. Ignore the rules about variety between nails, "at least three nails must differ",
            "no two nails may share the same combination", mood-based supporting elements, quiet vs busy
            nails, and the suggested axis combination. The five descriptions are the same wording apart from
            the finger. Leave pattern, motif and parts empty on every nail.
            """;

    // 키워드 뒤/앞에 이런 표현이 붙으면 "원컬러 싫어요/원컬러 말고" 같은 거부로 본다.
    private static final java.util.regex.Pattern NEGATION_AFTER = java.util.regex.Pattern.compile(
            "^.{0,12}?(싫|말고|빼|금지|제외|없이|아니|원치|않|마세요|하지 ?마|no\\b|not\\b|don'?t|avoid|never)");
    private static final java.util.regex.Pattern NEGATION_BEFORE = java.util.regex.Pattern.compile(
            "(no|not|don'?t|avoid|never|without|안|비|싫은|싫어하는)\\s*$");

    /** 원컬러/단색을 "원한다"고 읽히는 경우만 true. "(피해야 함)" 슬롯 줄과 "원컬러 싫어요/no one color" 같은 부정 표현은 제외한다. */
    private static boolean isUniformSetRequest(String confirmedInput) {
        if (confirmedInput == null) return false;
        for (String line : confirmedInput.toLowerCase().split("\\R")) {
            if (line.contains("피해야 함")) continue;
            for (String keyword : UNIFORM_KEYWORDS) {
                int from = 0;
                int at;
                while ((at = line.indexOf(keyword, from)) >= 0) {
                    String before = line.substring(Math.max(0, at - 12), at);
                    String after = line.substring(at + keyword.length());
                    boolean negated = NEGATION_AFTER.matcher(after).find() || NEGATION_BEFORE.matcher(before).find();
                    if (!negated) return true;
                    from = at + keyword.length();
                }
            }
        }
        return false;
    }

    /**
     * 프롬프트 지시만으로는 GPT가 손톱마다 마블/파우더/프렌치를 섞기 때문에, 원컬러 요청이면 코드로 5개를 같게 맞춘다:
     * 색 표현(시럽 또는 솔리드)을 하나로 정하고, 패턴/모티프/파츠를 비우고, 설명을 같은 문장으로 다시 쓴다.
     */
    private void enforceUniformSet(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        String userInput = confirmedInput == null ? "" : confirmedInput.toLowerCase();
        boolean matte = root.path("surface").asText("").toLowerCase().contains("matte");

        // 색 표현: 사용자가 말한 쪽, 없으면 손톱 중 가장 많이 쓰인 쪽(시럽 우선), 매트면 솔리드
        boolean syrup;
        if (matte) {
            syrup = false;
        } else if (userInput.contains("시럽") || userInput.contains("syrup") || userInput.contains("jelly") || userInput.contains("젤리")) {
            syrup = true;
        } else if (userInput.contains("솔리드") || userInput.contains("solid") || userInput.contains("불투명")) {
            syrup = false;
        } else {
            int jelly = 0, other = 0;
            for (String finger : FINGERS) {
                if ("jelly".equals(colorType(root.path(finger)))) jelly++; else other++;
            }
            syrup = jelly >= other;
        }

        // 베이스 색: 첫 번째로 값이 있는 손톱의 base_color, 없으면 상위 color
        String base = "";
        for (String finger : FINGERS) {
            String b = root.path(finger).path("base_color").asText("").trim();
            if (!b.isEmpty()) { base = b; break; }
        }
        if (base.isEmpty()) base = root.path("color").asText("").trim();
        base = base.replaceAll("(?i)\\b(base|syrup|jelly|solid|opaque|translucent)\\b", "").replaceAll("\\s+", " ").trim();
        if (base.isEmpty()) base = "milky white";

        String description = syrup
                ? "A " + base + " base in a translucent syrup-gel finish: one single uniform color across the whole nail "
                + "from cuticle to tip, with clear gel depth, soft light transmission through the edges, and a "
                + "high-gloss shine. No pattern and no decoration."
                : "A " + base + " base in an opaque solid " + (matte ? "matte" : "high-gloss") + " finish: one single even color "
                + "across the whole nail from cuticle to tip. No pattern and no decoration.";

        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            f.put("description", description);
            f.put("base_color", base);
            f.putArray("finish");
            if (syrup) addToArray(f, "finish", "jelly");
            f.putArray("pattern");
            f.putArray("motif");
            f.putArray("parts");
        }
        System.out.println("[FingerDesignPlan] 원컬러 세트로 고정: " + (syrup ? "syrup" : "solid") + " / " + base);
    }

    private String buildVariationLean(String confirmedInput) {
        java.util.concurrent.ThreadLocalRandom r = java.util.concurrent.ThreadLocalRandom.current();
        List<String> pool = new java.util.ArrayList<>(LEAN_SUPPORTING);
        java.util.Collections.shuffle(pool, r);
        String supporting = String.join(", ", pool.subList(0, 3));
        List<String> ribbonLooks = new java.util.ArrayList<>(LEAN_RIBBON_LOOKS);
        // 드로잉 계열 리본은 사용자가 드로잉/큐트 계열을 골랐을 때만 제안한다.
        boolean drawnOk = drawnRibbonAllowed(confirmedInput);
        if (!drawnOk) ribbonLooks.removeIf(look -> DRAWN_RIBBON_WORDS.matcher(look).find());
        java.util.Collections.shuffle(ribbonLooks, r);
        List<String> twists = new java.util.ArrayList<>(LEAN_TWISTS);
        java.util.Collections.shuffle(twists, r);
        return "\n[VARIATION LEAN] For this request only, supporting elements to try (use those that fit the mood): "
                + supporting + "; lean toward: charm look = "
                + LEAN_CHARM_LOOKS.get(r.nextInt(LEAN_CHARM_LOOKS.size()))
                + "; accent placement = " + LEAN_PLACEMENTS.get(r.nextInt(LEAN_PLACEMENTS.size()))
                + "; spiral / dot / line rendering = " + LEAN_RENDERINGS.get(r.nextInt(LEAN_RENDERINGS.size()))
                + "; flat motifs = doodle outline with a smooth gel-pen line, or a raised 3D piece"
                + "; hero nail = " + LEAN_HERO_NAILS.get(r.nextInt(LEAN_HERO_NAILS.size()))
                + "; ribbon look if a ribbon or bow is used (this one look on EVERY ribbon nail of the set, only size"
                + " and placement may differ) = " + ribbonLooks.get(0)
                + (drawnOk ? "; drawn ribbons are allowed this time"
                        : "; drawn or line-art ribbons are NOT allowed this time - every ribbon is a raised 3D bow charm"
                                + " or a low-relief embossed ribbon")
                + "; ribbon color lean (it may follow the palette or contrast with it) = "
                + LEAN_RIBBON_COLORS.get(r.nextInt(LEAN_RIBBON_COLORS.size()))
                + "; creative twists to explore (optional, use them if they fit and invent your own too) = " + twists.get(0)
                + " | " + twists.get(1)
                + ". These are soft suggestions: use them as the starting point and change any that clash with"
                + " the mood or the user's words.\n"
                + inkForDrawingLine(confirmedInput)
                + dotsLine(confirmedInput)
                + funkyLine(confirmedInput)
                // ★ 세트 구성(세 가지 디자인이 번갈아): 사용자가 고른 디자인 타입을 반영한 기본 배치
                + buildThreeDesignPlan(confirmedInput);
    }

    /** 펑키 무드: 파츠가 많고 화려한 것이 기본이다 - 절제(작게, 손톱당 1~2개, 조용한 손톱 여럿) 규칙의 예외. */
    private static String funkyLine(String confirmedInput) {
        if (!FUNKY_WORDS.matcher(wantedPart(confirmedInput)).find()) return "";
        return "\n[FUNKY MOOD - OVERRIDES THE RESTRAINT RULES] The user chose a funky mood: the set is bold, flashy, and richly"
                + " decorated, unlike other moods. Use MANY parts: layer rhinestones, pearls, chains, metal studs, and 3D charms (star,"
                + " heart, cross, bow, butterfly) on almost every nail as clusters, lines along the cuticle or free edge, or scattered"
                + " gems; three to four elements per nail are fine and at most one nail stays quiet. Charms may be medium sized (up to"
                + " about a third of the nail). Vivid or high-contrast colors, chrome, glitter, foil, and mixed motifs (star, butterfly,"
                + " cross, heart, lettering) are welcome, with contrasting textures (glossy plus chrome, gems plus chain). Every piece"
                + " stays a real, physically plausible, hand-set object and the nail stays tidy and readable.\n";
    }

    /**
     * 펑키 무드인데 파츠가 있는 손톱이 4개 미만이면, 파츠가 없는 손톱에 파츠(큐빅/진주/스터드/체인/스타 참)를 더해 화려하게 만든다.
     * 도트/블루밍/잉크 드로잉 손톱은 그 디자인이 전부라 건드리지 않고, 사용자가 모티프/파츠를 "없음"으로 골랐으면 적용하지 않는다.
     */
    private void enforceFunkyParts(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        String w = wantedPart(confirmedInput);
        if (!FUNKY_WORDS.matcher(w).find()) return;
        for (String line : w.split("\\R")) {
            if ((line.contains("motif") || line.contains("parts") || line.contains("핵심"))
                    && (line.contains("없음") || line.contains("none"))) return;
        }
        String[] parts = {"rhinestone", "pearl bead", "metal stud", "chain", "star charm", "pearl trim"};
        String[] sentences = {
                " A cluster of small rhinestones sits near the cuticle.",
                " A few small pearl beads are set along the free edge.",
                " Small silver metal studs are scattered across the nail.",
                " A delicate silver chain drapes along the nail.",
                " A small silver star charm sits near the cuticle.",
                " A fine pearl trim runs along the cuticle."};
        int offset = java.util.concurrent.ThreadLocalRandom.current().nextInt(parts.length);
        int withParts = 0;
        for (String finger : FINGERS) {
            if (root.path(finger).path("parts").isArray() && root.path(finger).path("parts").size() > 0) withParts++;
        }
        int added = 0;
        for (String finger : FINGERS) {
            if (withParts >= 4) break;
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            if (f.path("parts").isArray() && f.path("parts").size() > 0) continue;
            if (arrayContains(f.path("pattern"), "polka dot") || arrayContains(f.path("pattern"), "blooming")
                    || arrayContains(f.path("finish"), "ink")) continue;
            int k = (offset + added) % parts.length;
            addToArray(f, "parts", parts[k]);
            f.put("description", f.path("description").asText("") + sentences[k]);
            withParts++;
            added++;
        }
        if (added > 0) System.out.println("[FingerDesignPlan] 펑키 무드 → 파츠가 없던 손톱 " + added + "개에 파츠를 추가");
    }

    /** 사용자가 도트를 골랐을 때: 한 손톱 전체 도트 + 프렌치 팁 도트, 외곽선 없는 단순한 솔리드 도트. */
    private static String dotsLine(String confirmedInput) {
        String w = wantedPart(confirmedInput);
        if (!(w.contains("dot") || w.contains("도트"))) return "";
        return "\n[DOTS REQUESTED - VERY IMPORTANT] The user asked for dots. Dots are simple solid round dots without outlines"
                + " (never outlined cartoon circles). Put them on two nails: one nail where evenly spaced dots of one size cover the"
                + " WHOLE nail from cuticle to tip (nothing else on that nail), and one french tip nail where the dots sit only inside"
                + " the tip band. Never clusters, a few dots scattered on one side, or dots around another motif. With ink (drawing),"
                + " the dots are sheer ink-colored glass dots. Write pattern \"polka dot\" (not a motif) for them.\n";
    }

    private static final String INK_FOR_DRAWING_SENTENCE =
            " This is ink drawing art on top of the base color: the motif's shapes are filled with sheer, saturated transparent"
                    + " ink gel colors, with at most a thin light line in a slightly deeper tone (no black or heavy dark outline).";

    private static final java.util.regex.Pattern SYRUP_BASE_WORDING = java.util.regex.Pattern.compile(
            "(?i)\\b(?:translucent\\s+)?(?:syrup|jelly)(?:\\s+(?:gel|base|color))?\\b");

    /** 사용자가 드로잉을 골랐을 때(매트 제외) 그림이 들어가는 손톱의 베이스는 잉크라는 지시. */
    private static String inkForDrawingLine(String confirmedInput) {
        if (!wantsInk(wantedPart(confirmedInput))) return "";
        return "\n[DRAWING = INK ILLUSTRATION - VERY IMPORTANT] The user chose drawing. A drawing is an ink illustration like a cute"
                + " hand-inked sticker: the motif's shapes are FILLED with transparent ink gel colors (finish \"ink\") - sheer,"
                + " saturated, slightly uneven watercolor-like color areas - on top of a normal base color (syrup by default:"
                + " finish \"jelly\" plus \"ink\"), with at most a thin light line in a slightly deeper tone (no black or heavy"
                + " dark outline). Ink alone is NOT a drawing. Every nail that carries drawn art MUST have the visible ink fill and a"
                + " clearly recognizable, fairly large motif (ribbon, flower, clover, heart, star, lettering, a small cute"
                + " character) - never abstract lines, lacing, spirals, raised gel lines, or pearls instead. Use it on at least two"
                + " nails (three at most); the other nails may be syrup. In a matte set skip this.\n";
    }

    /**
     * 드로잉을 골랐는데 플래너가 잉크를 안 넣었으면, 그림이 들어간 손톱(최대 3개)의 베이스를 잉크로 바꾼다.
     * 시럽 표현은 잉크 워시 표현으로 바꾸고 "잉크 위의 얇은 선화" 문장을 덧붙인다. 참고 사진/수정 흐름에는 적용하지 않는다.
     */
    private void enforceInkForDrawing(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root) || !wantsInk(wantedPart(confirmedInput))) return;
        if (root.path("surface").asText("").toLowerCase().contains("matte")) return;
        List<ObjectNode> drawn = new ArrayList<>();
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            if (arrayContains(f.path("finish"), "ink")) return; // 이미 잉크가 있다
            boolean embossed = arrayContains(f.path("finish"), "sculpted 3d");
            boolean hasMotif = false;
            for (JsonNode m : f.path("motif")) {
                String v = m.asText("").trim().toLowerCase();
                if (!v.isEmpty() && !v.equals("none")) hasMotif = true;
            }
            boolean drawnPattern = arrayContains(f.path("pattern"), "plaid") || arrayContains(f.path("pattern"), "polka dot");
            if ((hasMotif && !embossed) || drawnPattern) drawn.add(f);
        }
        if (drawn.isEmpty()) {
            System.err.println("[FingerDesignPlan] ⚠ 드로잉을 골랐지만 그림이 들어간 손톱이 없어 잉크를 적용하지 못했습니다.");
            return;
        }
        int converted = 0;
        for (ObjectNode f : drawn) {
            if (converted >= 3) break;
            for (String effect : List.of("glitter", "magnetic cat eye", "powder finish", "chrome", "knit")) {
                removeFromArray(f, "finish", effect);
            }
            // 잉크는 베이스 색 위에 얹는 드로잉 요소다: 시럽 베이스(jelly)를 남기고(없으면 넣고) 잉크를 더한다.
            if (!WANTS_OPAQUE.matcher(wantedPart(confirmedInput)).find() && !arrayContains(f.path("finish"), "jelly")) {
                addToArray(f, "finish", "jelly");
            }
            addToArray(f, "finish", "ink");
            String description = f.path("description").asText("");
            if (!description.toLowerCase().contains("ink")) description = description + INK_FOR_DRAWING_SENTENCE;
            f.put("description", description);
            converted++;
        }
        System.out.println("[FingerDesignPlan] 드로잉 선택 → 그림이 있는 손톱 " + converted + "개에 잉크 드로잉을 적용(베이스 컬러 유지)");
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
        // ★ 사용자가 "원컬러/단색"을 요청했으면 손톱별 변주(보조 요소·랜덤 축 조합)를 전부 끄고 5개를 같은 한 색으로 고정한다.
        boolean uniformSet = !scanAutoMode && isUniformSetRequest(confirmedInputSummary);
        String variationLean = (uniformSet || hasImage || (previousPlanJson != null && !previousPlanJson.isBlank()))
                ? "" : buildVariationLean(confirmedInputSummary);
        String uniformSection = uniformSet ? UNIFORM_SET_SECTION : "";
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
                      Never make a one-color SET (all five nails identical); a plain one-color nail is fine
                      as one of the three designs of [THREE-DESIGN ALTERNATING SET].
                    - Give at least two fingers different base_color values, and give the remaining fingers
                      different details (finish, gradient, pattern) so the set varies.
                    - Give at least one finger an accent part that fits the colors and mood.
                    - Keep the five nails coherent as one set.
                    - Use the recommended shape written in the confirmed input exactly; never change it.
                    """;
        }
        String systemPrompt = String.format(SYSTEM_PROMPT, trendHint + variationLean, motifNoneRestriction,
                editModeSection + scanAutoSection + uniformSection, confirmedInputSummary);

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
            // 참고 사진/수정 흐름은 사진이나 기존 디자인의 리본을 따라야 하므로 새 디자인일 때만 드로잉 리본을 제한한다.
            if (!hasImage && (previousPlanJson == null || previousPlanJson.isBlank()) && !scanAutoMode)
                enforceNoDrawnRibbon(plan, confirmedInputSummary);
            if (!hasImage && (previousPlanJson == null || previousPlanJson.isBlank()) && !scanAutoMode) {
                enforceDotRules(plan, confirmedInputSummary);
                enforceHandDrawnCheck(plan, confirmedInputSummary);
                enforceBloomingForMood(plan, confirmedInputSummary);
                enforceFunkyParts(plan, confirmedInputSummary);
            }
            if (!hasImage && (previousPlanJson == null || previousPlanJson.isBlank()) && !scanAutoMode && !uniformSet) {
                enforceInkForDrawing(plan, confirmedInputSummary);
                limitColorExpressions(plan, wantedPart(confirmedInputSummary));
            }
            if (uniformSet) enforceUniformSet(plan, confirmedInputSummary);
            if (!uniformSet) logSetComposition(plan, confirmedInputSummary);
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