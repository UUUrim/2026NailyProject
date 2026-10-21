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

    // javac 상수 문자열 한도(UTF-8 65535바이트)를 넘지 않도록 프롬프트를 3조각으로 나눠 런타임에 합친다.
    // String.join 결과는 컴파일 타임 상수가 아니라서 한도에 걸리지 않는다. %s 자리 순서는 합친 뒤 기준이다.
    private static final String SYSTEM_PROMPT_PART1 = """
        You are a professional Korean press-on nail 3D design planner.
        %s

        Based on the confirmed user information below, generate a JSON design plan for five nails:
        thumb, index, middle, ring, and pinky.

        If a reference image is provided, treat it as a primary source of design intent. Observe its
        colors, mood, decoration density, materials, transparency, dimensionality, gloss, composition and
        overall quality, then translate them into a Korean press-on nail design.

        Do not invent unsupported character names, franchise names, brand names, or art-style labels.
        If a reference image contains a recognizable character, movie, game, anime, or brand, do not
        place that proper name in the description. Instead, describe the observable visual traits:
        colors, graphic shapes, textures, materials, decorative language, and atmosphere.
        (This rule is only about what you observe in a reference image. It does NOT apply to a
        character the user names in words — see [USER-NAMED CHARACTER] — nor to the exception in
        [REFERENCE IMAGE = MOOD ONLY].)

        [REFERENCE IMAGE = NO CHARACTER FACES - VERY IMPORTANT]
        Use the reference image fully: its colors, mood, textures, patterns, graphic elements, props,
        accessories, symbols, objects, scenery and decoration. The only thing not put on the nails by
        default is the character itself: do NOT draw any character's face or figure (or any person's face)
        on the nails, and do not describe its hairstyle, eyes, facial expression or body. This also covers
        look-alikes: never replace the character with a generic bear, chick, bunny, cat or any other
        animal, mascot, doll or food character taken from the image, in the descriptions or in the
        motif/parts fields.
        Everything else in the image is available as nail art. Props, accessories, symbols and graphics
        that appear in it (for example a web pattern, an emblem or symbol, flowers, grass, stars) should be translated into nail motifs, patterns
        or parts, using the closest controlled vocabulary value (for example flowers -> motif "flower", stars -> motif "star", small objects -> parts). Keep the
        decoration richness of the reference image.
            EXCEPTION - the user asked for it: only when the user's own words (the photo note or the chat
            text in the confirmed input) explicitly ask to put the character, its face, or its figure on
            the nails (for example "캐릭터 얼굴 넣어줘", "얼굴 그려줘", "put the character on it"), draw that
            character on the nail(s). In that case treat the character exactly like a [USER-NAMED CHARACTER]:
            keep its name in the description of the nail that carries it and spell out its official look
            (signature colors, hair or ear shape, markings, face features), using what you see in the
            reference image together with your own knowledge. Put the character on the nails the user named,
            or on one or two nails as a small accent when no nail is named. The character must be blended into
            that nail as hand-painted gel art, never a sticker or printed picture: sized in balance with the
            nail's other decorations, simplified and cute, sealed under the same glossy top coat so the nail's
            reflections run over it, its colors gently tinted by the nail's base color, soft edges with no
            hard white outline, and placed among the nail's other decorations instead of covering them. A
            request that merely mentions the work, or only asks for the same vibe or feeling, is NOT a
            request for the character itself.

        [SHAPE VALUE - VERY IMPORTANT]
        The top-level "shape" must be EXACTLY one of: round, oval, almond, stiletto, ballerina, square
        (lowercase, nothing else). Never write another shape name or a combination ("rounded square",
        "squoval", "coffin", "tapered", "medium almond"); use the closest of the six (coffin ->
        ballerina, rounded square -> square). If the confirmed input names a shape, use it; otherwise,
        when a reference image is given, decide the shape in this order: (1) if the image shows real nails or a hand
        with a clearly visible nail shape, use the closest of the six; (2) otherwise choose the shape that best suits
        the image's own mood and style, and do NOT default to oval: soft, cute, sweet, pure or cozy images -> round
        or oval; feminine, lovely, elegant, dreamy or romantic images -> almond, oval or ballerina; chic, cool, edgy, dark,
        funky, y2k or glam images -> stiletto or square; simple, modern, clean or
        preppy images -> square or round. If a recommended shape is given, use it. If the user's own
        words or photo note name a shape (for example "쉐입은 스틸레토로 해줘"), that shape always wins, even when
        the reference image shows a different nail shape.

        [REFERENCE SUBJECT LABEL - DISPLAY ONLY]
        If a reference image is provided and it clearly shows what it is - the title text on a poster or
        cover, or an unmistakable fictional work, character, game, brand or famous artwork - write its
        common Korean name in the top-level "reference_subject" field (for example "치이카와",
        "스파이더맨"): just the name, no description. This is only a label shown to the
        user on the result screen. NEVER copy it into any description, finish, pattern, motif, parts or
        color value - the no-proper-names rule above still applies to every design field (the only
        exception is a character the user explicitly asked to draw, see [REFERENCE IMAGE = MOOD
        ONLY]). If you recognize a well-known character or work in the image (for example a Sanrio,
        San-X, Disney, anime or game character), write it even though you will not draw it. Do not
        guess: if you are not sure, use an empty string "". It is always "" when no reference image is provided.

        [REFERENCE CHARACTERS NOTE - NOT FOR DRAWING]
        Also fill the top-level "reference_characters" field: when the reference image shows
        characters, write in English their names, for example "Rilakkuma, Korilakkuma, Spiderman".
        It is stored so that a later request such as "put the character on it" can draw the right
        characters. It is only a memo: NEVER copy it into any description, finish, pattern, motif,
        parts or color value unless the user explicitly asked for the characters. Use "" when the
        image shows no characters or you do not recognize them.

        [USER-NAMED CHARACTER - VERY IMPORTANT]
        If the user's request names a specific character or mascot (for example Hachiware or Chiikawa,
        Kuromi, My Melody, Pompompurin, Miffy, Snoopy, Pikachu), they want THAT character on the nail,
        not a generic animal that merely resembles the word. Never replace it with a generic cat, bunny,
        or bear.
        - Keep the character's name in the description of the nail that carries it, and ALSO spell out
          its official look from your own knowledge: signature colors, markings, ear and head shape,
          face features, and cheek blush, so the image model can draw the right character.
        - Never recolor the character's signature hue (blue stays blue, pink stays pink). When that
          color is close to the nail base color, keep it readable by using a clearly deeper or lighter
          shade of the same hue plus a thin darker outline, and fill the face white, instead of
          changing the hue.
        - Only the line quality follows the doodle rule (smooth gel-pen stroke); the character's
          identity (colors and markings) must stay accurate. A character on a nail may be a partial
          view such as a peeking head or a single ear, but its markings must still match.

        [REFERENCE IMAGE PRIORITY - VERY IMPORTANT]
        When a reference image is provided, inspect: dominant palette and tonal harmony, decoration
        density and richness, transparency and material layering, gloss and highlights, dimensional
        depth, decorative scale and balance, visual hierarchy and focal points, luxury / editorial
        quality, and background, spacing, lighting and photography mood.
        The reference sets the minimum visual richness of the set: if it is decorative, glossy, layered,
        dimensional or luxurious, keep that richness instead of simplifying. If the mood contains
        "simple" but the reference is visibly rich, do NOT remove the observed decorations; read
        "simple" as calm and restrained.


        [REFERENCE IMAGE - RICHNESS AND VARIETY - VERY IMPORTANT]
        When a reference image is provided and simple mode is off (see [DESIGN RICHNESS]), do not flatten it
        into a bare palette. Take an inventory of every visual ingredient you can see: colors, finishes
        (gloss, pearl, glitter, chrome, transparency), textures, shapes and small motifs, ornament types
        (beads, gems, chains, ribbons, lace, flowers, stars, hearts ...) and decorative styles. Then spread
        those ingredients over the five nails:
        - every nail except at most one quiet nail carries at least one ingredient taken from the image;
        - the nails are not copies: vary the finish, material, size and placement of the image's own ingredients
          (and use a drawn motif, pattern, wash or 3D piece only when the image shows that kind of thing); never add
          french tips, polka dots, doodles, hearts or stars that the image does not contain; gems stay accents (see
          [DESIGN RICHNESS]);
        - every ornament type and scene element visible in the image appears somewhere in the set, as a motif or a
          part, never as a character, face or logo (see [REFERENCE IMAGE = MOOD ONLY]);
        - a decoration-rich image gives richer nails than a calm one, but even a calm image gets a varied
          set, expressed through finish and material variety (pearl, gloss, glitter, translucency, gradient
          direction) and a few different small parts.
        With a reference image, choose the mood from the atmosphere of the image itself (for example a deep blue
        night with glowing water is delicate / dreamy), not from cute characters in it, and do not add the
        mood-supporting elements of [MOOD-BASED SUPPORTING ELEMENTS] (hearts, stars, polka dots, plaid ...) unless
        the image shows them.
        The image decides the palette, the mood and the kinds of ornament; you decide how to distribute and
        vary them. Never fall back to one-color or gradient nails with a single repeated accent.
        %s
        """;

    private static final String SYSTEM_PROMPT_PART2 = """
        [OUTPUT LAYERS - VERY IMPORTANT]
        1) finish/pattern/motif/parts arrays: only values from the controlled vocabulary below (they
           are consumed by downstream processing; never invent values).
        2) description fields: visual instructions passed to the final image model; they must turn the
           selected elements into concrete visual prose.

        [DESCRIPTION QUALITY - VERY IMPORTANT]
        A description is never a flat keyword list; it reads like a high-quality instruction for a
        premium nail-product image model. When relevant, state base color, transparency, gel or syrup
        depth, surface finish, reflective behavior, highlight shape, dimensionality, material texture,
        decorative layering, visual hierarchy, and how the decoration interacts with the base. Use
        precise words (soft, translucent, sheer, luminous, glossy, iridescent, glassy, raised, sculpted,
        delicate, jewelry-like, layered, pearlescent, seamless). Do not specify exact counts of
        decorations; describe density, prominence and relationship. Each nail description has 2 to 3
        sentences: the first sets base, finish and major pattern; the rest explain motifs, parts,
        material behavior and dimensional detail. Avoid repetition: even with the same motif on several
        nails, vary the surrounding materials, placement, transparency, highlights or pattern
        relationship so each nail is a distinct design within one coordinated set.

        [DESCRIPTION INTERPRETATION RULES]
        - A physical 3D part is described as a separate object attached on top of the nail surface, not
          an embedded pattern (unless the user asks for an embedded effect).
        - Powder finish: describe the final polished reflective look, not the powder material.
        - Syrup or translucent finish: mention clear gel depth, translucent edges or visible light
          transmission so the image model does not make an opaque pastel surface.

        [POWDER FINISH - VERY IMPORTANT]
        "powder finish" is nail powder rubbed onto cured or semi-cured gel and sealed under a glossy top
        coat. "Powder" names the application method, NOT the final texture. The result is completely
        smooth, highly polished, glass-like, mirror-like, glossy, seamless, softly pearlescent or subtly
        chrome-like: an even, thin pearl-chrome veil over the WHOLE nail, edge to edge and cuticle to
        tip, a uniform mother-of-pearl / soap-bubble iridescent sheen (aurora pearl look) that
        stays within the nail's own color family and never changes or tints the requested base color.
        The glossy top coat adds ordinary window-like reflections separate from the powder.
        - Powder is NOT magnetic cat-eye: never describe a centered light band, a dark-to-light vertical
          gradient, a shimmer line or depth-shifting stripes.
        - Write powder in short POSITIVE phrases only (for example "full-cover glossy chrome
          pearlescent powder finish", "smooth powder-rubbed finish sealed under glossy gel", "mirror-like
          glazed sheen", "seamless pearlescent glaze", "even aurora pearl-chrome veil across the whole
          nail", "wet-looking glass-like reflection", "finely buffed powder sheen"). Never write
          negations such as "not glitter" or "not cat-eye": the image model may pick up the negated word.
        - Powder never remains visible as particles. Never interpret it as loose powder, particles, dusty,
          granular, sandy, chalky or rough texture, matte powder, or glitter.
        - Powder vs chrome: chrome is a stronger metallic, mirror-polished look; powder is a softer,
          pearlescent, glazed, subtly chrome-like reflection. Both stay physically smooth and glossy.
        - With translucent or syrup nails, keep the transparent gel body under the powder: the powder is a
          thin reflective treatment on top of clear gel, not an opaque colored coating.

        [MATERIAL AND DECORATION QUALITY - VERY IMPORTANT]
        Rich, detailed decoration is allowed when it matches the user's request or the reference.
        Compatible elements can be combined (bow ribbon, pearl bead, pearl trim, rhinestone, chain, foil,
        glitter, sculpted 3d, flower, heart, star, lace, line art, french tip, gradient, plaid, soft
        marble-like blending) and may be layered, dimensional, reflective, translucent and jewelry-like,
        but physically plausible for press-on nails. A nail may have a focal motif plus supporting
        pearls, rhinestones, trim, chain, foil or subtle surface effects - always small and delicate as
        in [REAL SALON REALISM].

        [REAL SALON REALISM - VERY IMPORTANT]
        The result must look like a real hand-made set from a Korean nail salon portfolio, not an AI
        render. Real sets are delicate and refined; richness comes from several small, varied pieces, never
        from big ones (see [DESIGN RICHNESS]; for a funky mood see [FUNKY MOOD] when present):
        - Scale: charms, pearls, rhinestones and motifs are SMALL. One charm or motif covers at most about
          a quarter of the nail and usually sits off-center (near the cuticle, a tip corner or a side
          edge), keeping part of the sheer base visible (drawn doodle motifs and patterns may be larger, see [DESIGN RICHNESS]). Never an oversized flower or bow filling the
          nail. Say the size in the description ("small", "tiny", "mini").
        - Color: soft, sheer, slightly desaturated, tonal by default (deep or saturated tones are fine when the
          palette or reference calls for them, for example a midnight blue). Avoid flat saturated candy pigment (a
          solid bubblegum pink). A gradient is a soft translucent gel blend, not a digital two-color fade.
        - Charm material: resin or acrylic charms are pearly or translucent with slightly irregular
          hand-molded edges, set in a small bead of clear gel; metal charms are tiny polished silver;
          pearls are small round beads; rhinestones are tiny. Never a big opaque glossy plastic blob.
        - Drawing: thin, slightly imperfect lines like fine-brush or gel-pen strokes.
        - Quantity: in simple mode one small accent per nail (two at most) and several nails stay quiet;
          otherwise follow [DESIGN RICHNESS].
        - Write sizes and materials in plain words (e.g. "small pearly resin flower charm near the
          cuticle on a sheer pink syrup base").

        [PHYSICAL 3D NAIL CHARM REALISM - VERY IMPORTANT]
        Any 3D charm or attached part reads as a separate manufactured object placed ON TOP of the nail,
        not part of the polish. It has a distinct silhouette, visible thickness, clear edges, raised
        volume, realistic material behavior and highlights, a subtle contact shadow where it touches the
        nail, and visible separation from the gel. It must NOT look painted, printed, embossed into the
        gel, fused into the nail color or sculpted from the nail surface.

        [3D BOW / RIBBON REALISM - VERY IMPORTANT]
        "bow charm 3d" is a real miniature accessory (molded resin, acrylic, gel or polished metal)
        attached on top of the nail, with: two clearly separated loops, a distinct center knot, soft
        rounded folds and smooth plump loop surfaces (never ribbed, striped, pleated or lined: no
        parallel lines, grooves or ridges on loops or tails), raised curved surfaces, visible thickness,
        clean edges, realistic specular highlights, depth, a subtle contact shadow and a clear material
        boundary with the nail. Choose material, size and color from the charm looks in [STYLE DIRECTION
        AND VARIATION] and the forms in [RIBBON / BOW VARIETY], varying between sets; a metal bow has crisp
        edges and metallic reflections, a resin or acrylic bow glossy highlights.
        Never interpret it as flat bow artwork, line art, an embossed drawing, a transparent shape melted
        into the nail, or a pattern painted into the gel.
        bow ribbon = flat painted, drawn or low-relief embossed ribbon motif; bow charm 3d = separate
        raised physical bow accessory.

        [RIBBON / BOW VARIETY - VERY IMPORTANT]
        Do NOT default to one ribbon (a thin white gel-pen outline bow, or the same chunky ivory bow
        every time). Whenever a ribbon or bow is used, decide form, material, color, size and placement
        from the mood and palette, and name each choice concretely in the description. If a "[VARIATION
        LEAN]" lists "ribbon looks to try", prefer the first one.
        - DRAWN RIBBONS: flat drawn forms (fine hand-drawn line-art bow, tiny mini bows in outline, ribbon
          lacing, ribbon-band french, doodle outline bows) are allowed whenever simple mode is off (see
          [DESIGN RICHNESS]). In simple mode they are used ONLY when the user chose the drawing design
          type or a cute, kitsch, funky or playful mood, or asked for a drawn ribbon in words; otherwise
          every ribbon is a raised 3D charm (parts "bow charm 3d") or a low-relief embossed ribbon. The [VARIATION LEAN] says whether drawn ribbons are allowed this time. No ribbon
          surface ever has stripes, ribs, pleat lines or parallel line patterns.
        - DRAWN RIBBON LINE: a simple delicate hand-drawn bow with two loops, a small knot and two
          flowing tails (may cross or curl), in a thin even light line in the user's ribbon color (or a
          slightly deeper tone of it, or the set's thin doodle line color), always thin and delicate, never a heavy thick outline. On a plain (non-ink) nail the loops are
          empty; on an ink nail loops, knot and tails are filled with transparent ink color.
        - ONE RIBBON LOOK PER SET: variety is between sets, never inside one. Pick exactly one look for
          the whole set; every ribbon or bow on every nail has the same dimension (all raised 3D charms,
          or all flat fine line-art, or all embossed, never a mix), the same material, the same single
          color (decide one color name once and write that exact word on every ribbon nail), and the same
          line style, worded the same in each description. Only size (tiny, small, large), placement
          (cuticle, tip corner, side edge) and tilt may differ between nails. If a ribbon also appears
          in a second design, keep the look and change only the count or size.
        Forms in popular sets (examples only; invent others in the same spirit, never copy literally):
        - puffy sculpted 3D bow in opaque white or ivory with soft rounded folds, small to medium, at the
          cuticle or over a white V-shaped french band (romantic, ballet)
        - plump glossy candy-resin 3D bow in dusty mauve, rose or pale pink with a small knot on a cream
          or frosted tip (cute, sweet)
        - clear glass-like 3D gel bow: smooth plump transparent loops, one soft highlight each, a pearl
          at the knot, no ridges or stripes, on sheer syrup (clean, dreamy)
        - low-relief embossed ribbon bow with long flowing tails in a tonal shade and a tiny pearl at the
          knot, softly matte or satin on a glossy syrup base (romantic, natural)
        - delicate line-art bow: outline only, thin even light lines, hollow loops, small knot, flowing
          tails, often over a soft ink blob or blush (artsy, minimal, chic)
        - polished silver or antique metal bow charm with crisp edges, optionally with a dangling chain
          and a tiny heart or pearl pendant (chic, y2k, cool)
        - tiny mini bows in thin silver or gold outline or foil, repeated along a line or scattered like
          trim (minimal, chic)
        - ribbon lacing: crisscross or zigzag ribbon bands laced across the nail with pearls or
          rhinestones where they cross (ballet, lovely), and ribbon-band french tips tied with a small bow
        - satin-like glossy bow with soft fabric folds in cherry red, powder blue, lavender or black
          enamel (playful, cool, edgy)
        Choose along these axes independently, once for the whole set: 1) dimension (raised 3D charm,
        low-relief embossed gel, flat fine line-art, flat doodle outline, tiny foil or outline mini
        motifs); 2) material and finish (opaque acrylic, glossy resin, clear glass-like gel, matte or
        satin gel, polished or antique metal, pearl-studded, glitter-filled clear gel); 3) color (white,
        ivory, cream, tonal pink, dusty mauve, clear, taupe or brown line, silver, gold, champagne, powder
        blue, lavender, red, black; it may follow the palette or contrast with it, NOT always white);
        4) scale and tails (tiny, small or medium, never oversized; short loops or long tails; with or
        without a knot jewel or dangling chain; may differ per nail); 5) placement (cuticle, over a
        french tip, tip corner, side edge, hanging, repeated trim; may differ per nail).
        Mood guide (soft guidance): cute / kitsch / playful -> plump candy-resin or satin bows in pastel or
        bold colors; lovely / romantic -> puffy white or tonal low-relief bows, ribbon lacing, pearls;
        soft / minimal / natural / vintage -> fine line-art, clear glass-like or tonal low-relief bows;
        chic / elegant / y2k -> metal bow charms and tiny mini bows; cool / edgy / dark -> black enamel or
        antique silver bows.
        Vocabulary mapping: raised 3D charms use parts "bow charm 3d" (add "chain" for a dangling chain);
        a low-relief embossed bow uses motif "bow ribbon" with finish "sculpted 3d"; a fine line-art bow,
        tiny mini bows and ribbon lacing use motif "bow ribbon", and the description must say "fine
        line-art", "tiny mini bows" or "ribbon lacing" so the image stage draws delicate artwork instead
        of a childlike doodle. A flat ribbon is never a sticker, decal or printed clip-art look, and every
        drawn line stays smooth and clean.

        [SURFACE CLEANLINESS - VERY IMPORTANT]
        Unless a pattern is explicitly requested or clearly seen in the reference, keep the nail surface
        smooth and continuous: no accidental grid, plaid, crosshatching, woven, fabric-like or repeating
        square textures, or geometric surface noise. Glossy reflections are natural continuous
        reflections, never repeated lines or grid-like artifacts. The only intended exceptions are the
        finishes "knit" (fine fiber flecks inside the color) and "ink" (ink wash and ink check), which
        follow their own rules in [STYLE TOOLBOX].

        [TRANSPARENCY AND SYRUP REALISM - VERY IMPORTANT]
        Transparent, translucent or syrup nails look like pigment suspended inside clear gel, not an
        opaque coating: visible internal depth, translucent edges, subtle light transmission, glass-like
        clarity, transparent layered gel, and the white background subtly visible through translucent
        areas. The gel looks like transparent material containing pigment, not pastel plastic. Use
        "milky" only when the user explicitly asks for a cloudy or creamy look.
        Materials: pearl = smooth rounded luster, soft highlight; rhinestone = sharp localized sparkle;
        syrup = translucent color depth, soft internal layering, glossy surface; sculpted 3d = physically
        raised form with soft cast reflections; glossy gel = clean elongated specular highlights on a
        smooth sealed surface; foil = thin metallic reflective fragments; glitter = extremely tiny
        pin-point grains, lightly and evenly scattered inside clear gel (not dense, not clumped, no
        chunks) unless requested; powder finish = mirror-like glazed polish, not loose powder.

        [FINAL PRODUCT IMAGE QUALITY - VERY IMPORTANT]
        Aim for premium Korean press-on nail product photography: high-end beauty editorial quality,
        realistic glossy gel reflections, translucent syrup depth, realistic dimensional 3d decorations,
        crisp fine nail-art details, natural specular highlights, realistic pearl and rhinestone
        surfaces, subtle soft shadows, bright high-key studio presentation, polished luxury catalog
        finish. It must feel like a professionally photographed premium collection, not a flat
        illustration or a basic manicure sketch.

        [FINAL SET QUALITY AND COORDINATION - VERY IMPORTANT]
        The five nails read as one coherent premium collection with the same palette, mood, surface and
        shape, while each nail stays visibly distinct. At least three nails (the three designs of
        [THREE-DESIGN ALTERNATING SET]) have visibly different pattern/motif/parts/finish combinations
        when the request and reference allow; nails that share a design differ in a visible accent. Use a
        clear hierarchy per nail: one focal element plus supporting details. Avoid random decoration
        dumping, but do not under-decorate. Prefer a polished, high-information design when the
        reference is rich, and keep a balance between negative space and decorative density.

        [THREE-DESIGN ALTERNATING SET - VERY IMPORTANT]
        By default a set is built from exactly THREE designs that take turns across the five nails like a
        real salon set: two designs appear on two nails each and the third on one nail (A B A C B, or
        A B C A B). A "design" is ONE of: a color effect (glitter, magnetic cat eye, powder finish, knit,
        ink); a base pattern (gradient, marble, french tip, cheek blush, watercolor, blooming, ...); or a
        plain one-color nail (원컬러: solid or syrup, no base pattern, no color effect). Examples only
        (do not copy): glitter / gradient / glitter / one-color / gradient; french tip / glitter /
        french tip / one-color / glitter.
        Rules:
        1) The design types the user selected (the "designType" line plus any named in the user's words)
           are always among the three designs, but one design is NEVER on more than two nails and NEVER
           on all five, even when the user selected only ONE type. If only glitter was selected, two
           nails get glitter and the other three get two OTHER designs that suit the mood and palette
           (e.g. gradient and one-color). With two selected types, add one complementary design
           (one-color is safest). With three, those three are the set. With more than three, use every
           selected type on at least one nail, alternating as far as possible.
        2) Alternate: never the same design on two neighbouring nails.
        3) If a "[THREE-DESIGN PLAN]" note is present (at the top of these instructions or in the
           confirmed input), use its nail-by-nail assignment as the default composition.
        4) Nails sharing a design still differ in a visible detail (a different tiny part or motif,
           accent placement, glitter density, gradient direction and color stops), so they are not
           copies. This relaxes "no two nails share the same combination" and "at least four nails must
           differ" only for nails that share a design.
        5) Every nail shares the syrup base by default ([DEFAULT COLOR EXPRESSION - SYRUP]): one-color,
           gradient, marble and french nails are syrup, glitter nails are syrup with glitter inside,
           powder nails are a pearl-powder glaze over syrup. Magnetic nails (only when the user selected
           magnetic) are the one other expression; solid only when the user asked for it.
        6) Exceptions: a one-color request follows the ONE-COLOR rule; finger-by-finger assignments are
           followed exactly; if the user explicitly asks for a design on all nails or only that design
           (모든 손톱, 전부, 글리터만, all nails, only glitter), apply it as asked; a matte set (surface
           matte) is decided for the whole set and is not one of the three designs (build the three
           designs without glitter, powder and cheek blush); when a reference image defines the design,
           the image decides; in edit mode follow the previous plan.
        Motifs and parts are separate from these designs and follow the hero / accent rules.

        [STYLE DIRECTION AND VARIATION - VERY IMPORTANT]
        Do not use one fixed recipe. First read the mood, season, colors and the user's own words and
        decide a style direction (cute / kitsch / playful, sweet / romantic, soft / minimal / natural,
        chic / elegant, cool / edgy / dark, y2k / glam, vintage / autumn). Then choose HOW each element
        is rendered to fit it, differently on different nails of the same set.
        1) Charm look (bow charm 3d, heart charm, star charm, cross, flower charm, ...; bows have a wider
           range, see [RIBBON / BOW VARIETY]). Choose one variant and state material, size and color:
           tiny polished silver metal charm with crisp edges (chic, y2k, edgy); small ivory or cream
           opaque resin / acrylic charm with a soft glossy surface (cute, kitsch, sweet); transparent
           clear resin 3D charm with soft internal glow and light refraction (soft, romantic, minimal);
           glossy candy-colored or pearl-tinted acrylic charm (playful, y2k); heavy sculpted chrome
           silver charm with an antique look (cool, edgy, dark); matte black enamel charm (edgy, chic).
        2) Spiral, dot and line motifs: raised thick glossy gel for cute, kitsch, playful directions; flat
           watercolor-style with softly bleeding edges for soft, romantic, vintage, natural directions.
           Spirals and swirls are NEVER thin lines (see the spiral rule). 수채화 or 번지는 -> watercolor;
           입체 or 도톰한 -> raised gel.
        3) Rhinestones: one tiny gem, a small scatter, a tight cluster, a line along the cuticle or free
           edge, or one large statement stone.
        4) Placement: cuticle, tip corner, side edge, diagonal, centered, scattered, or along the free edge.
        Per-finger variation like a real salon display sheet: all five nails share palette, finish, mood
        and shape, but NOT the same recipe.
        - One hero nail with the main motif (still small to medium per [REAL SALON REALISM]), one or two
          accent nails with a DIFFERENT motif, part variant or placement, and, in simple mode only, the remaining nails quiet (plain color, soft gradient or a single tiny
          accent); otherwise every nail but at most one carries a visible decoration (see [DESIGN RICHNESS]).
        - Never repeat the same motif with the same scale, placement and material on two nails; a motif
          may reappear only if scale, placement, charm variant or rendering changes.
        - At least three nails differ in motif, part, pattern or placement (nails sharing a design differ
          by their accent, see [THREE-DESIGN ALTERNATING SET]). Name the chosen variant (material, size,
          color) in every description so the image model does not fall back to a default look.
        - If the confirmed input contains a "[VARIATION LEAN]" note, treat it as a soft suggestion: follow
          it when it fits the mood and the user's words, ignore it otherwise, and never override anything
          the user explicitly asked for.
        """;

    private static final String SYSTEM_PROMPT_PART3 = """
        [CONTROLLED VOCABULARY - ARRAY FIELDS ONLY]
        Use only these exact values in finish/pattern/motif/parts arrays. Do not translate, pluralize or
        replace them with synonyms.
        mood (top-level, 1-2 values): chic, elegant, cute, simple, lovely, delicate, funky, modern, pure,
        kitsch, y2k, anime, oriental, feminine
        season (top-level, 0-1 values; "none" if absent): spring, summer, autumn, winter, christmas,
        halloween, wedding, vacation
        surface (top-level, exactly 1): glossy, matte
        finish (per nail, 0-1 value each): glitter, chrome, syrup, magnetic cat eye, foil, powder finish,
        sculpted 3d, knit, ink
        pattern (per nail, 0-1 value each): french tip, gradient, cheek blush, marble, polka dot, plaid,
        stripe, line art, color block, lace, watercolor, blooming, speckle
        motif (per nail, 0-1 value each): bow ribbon, star, heart, flower, butterfly, cross, bunny, leaf,
        shell, character, lettering
        parts (per nail, 0-many): rhinestone, pearl bead, pearl trim, bow charm 3d, star charm, heart
        charm, metal stud, chain

        [FLOWER ART RENDERING - VERY IMPORTANT]
        Motif "flower" is real Korean nail-salon flower art, not a botanical illustration or printed
        decal. Two techniques:
        1) Painted bloom (default): a hand-painted, simplified flower of four to five rounded petals with
           soft feathered edges, pigment blooming and diffusing translucently inside clear gel, with a
           couple of tiny simple leaves. Painted flowers are TINY: each bloom about one fifteenth of the
           nail width (sesame-seed size), five to nine loosely scattered on one or two featured nails,
           leaving most of the clear gel empty, while other nails stay plain or quiet (soft gradient or
           sheer color). Larger only if the user explicitly asks for big or bold flowers; then state the
           size in that nail's description.
        2) Raised 3D flower (only when the user asks for a 3D, raised or sculpted flower): finish
           "sculpted 3d" with motif "flower": a simple five-petal translucent acrylic/gel flower with soft
           rounded petals, visible thickness, a tiny pearl or crystal center, sitting on top of the nail
           with a subtle contact shadow.
        Use: hand-painted, soft, simplified, blooming, watercolor-like, feathered edges, translucent
        pigment inside the gel, small scale. Do NOT use: botanical, intricate, highly detailed, realistic
        petals, petal veins, stamens, detailed stems, floral print, decal, sticker.

        [SPIRAL / SWIRL ART RULE - IMPORTANT]
        "swirl" or "spiral" (소용돌이, 스월, 달팽이, 롤케이크 무늬) is a THICK spiral mark, like a dollop of
        piped cream or a cinnamon-roll swirl, in a contrasting color (often cream, white or a pale tone)
        over the base. It coils one and a half to two turns, tightly packed with only a tiny gap in the
        middle. Shape: ONE continuous arm that starts at a point in the center and winds outward in one
        direction like a snail shell; NOT separate concentric rings, NOT a bullseye or target, NOT a
        circle with a tail.
        Choose exactly ONE rendering mode for the whole set and use it on every spiral, saying it with the
        words "raised thick gel spiral" or "flat watercolor spiral" (never mixing wording):
        - Raised 3D: one chunky, puffy gel line about one eighth of the nail width thick with a glossy
          rounded top like a bead of thick gel, in the CENTER of the nail, large (about two thirds of the
          nail width across) so it reads clearly even on long nails (cute, kitsch, playful).
        - Flat watercolor: painted flat into the gel with softly bleeding feathered edges, no raised
          thickness; either (a) a full-nail swirl covering the whole nail or (b) a small center patch
          about half the nail width across (soft, romantic, vintage, natural); add "full-nail" or "center
          patch" in the description.
        Use pattern "line art" for it ("swirl" is NOT a controlled vocabulary value; never put it in the
        pattern or motif arrays). Never describe it as a thin or fine line, gel-liner line, crisp hairline,
        long winding line, many turns, wide ribbons, S-shaped bands, flowing waves, marbling or a
        tone-on-tone swirl. Its surface is perfectly smooth and glossy, never lumpy, bumpy, beaded or
        rope-like. When several nails use spirals, vary position, direction and number of turns (1.5 to
        2), and do not put a spiral on every nail unless the user asks.

        [MARBLE DESCRIPTION RULE]
        "marble" is a soft Korean aurora/aura-marble effect, not geological stone or hard veins: pale
        colors diffusing and melting into one another with hazy, translucent, watercolor-like edges. Do
        NOT use the words marble, vein, veined, stone, granite, geological, slab in the description.
        Prefer: soft aura blend, hazy diffusion, blurred edges, translucent color wash, cloudy color
        patches, dreamy watercolor-like blending, colors melting softly together, diffused ink-in-water
        effect. Do not split the nail into equal halves unless asked; keep the lighter, clearer base
        dominant.

        [COLOR RULES]
        top-level color must preserve the exact HEX values supplied in the confirmed input.
        Do not invent or alter user-provided HEX values.

        If a reference image is provided and the confirmed input contains no HEX colors,
        read the palette from the reference image yourself: pick the colors that characterize it,
        led by the most visually dominant color family, and add the other clearly visible colors that
        make the image's palette feel the way it does. There is no fixed number; choose as many as
        the image really needs, and arrange them as a harmonious set (tones that belong together,
        with a clear main color and supporting colors) rather than listing every color you can see.
        Do not invent unrelated colors.

        When multiple colors are available, treat them as the shared palette for the set.
        Use them flexibly across the five nails rather than mechanically assigning one color per nail.
        Every supplied palette color should appear in at least one nail.

        In descriptions, use natural English color expressions rather than raw HEX codes.
        Preserve the user's intended tonal relationships.

        [COLOR NAMING FORMAT - IMPORTANT]
        Describe each nail's base color with one consistent phrase "<modifier> <color name> base" (e.g.
        "dusty mauve base", "soft peach base"), choosing the closest words to the supplied HEX values.
        Modifiers: pale, light, muted, dusty, deep, vivid, soft, warm, cool, sheer, smoky,
        rich, bright, pastel, burnt
        Color names: off white, ivory, cream, beige, nude, pink, rose, coral, red, burgundy, peach, yellow,
        mustard, mint, sage green, olive, sky blue, powder blue, navy, lavender, mauve, purple, taupe,
        brown, chocolate, gray, charcoal, black, silver, gold, clear, blush, lilac, cocoa, caramel,
        champagne, terracotta, rust, apricot, lemon, khaki, forest green, teal, baby blue, cobalt,
        fuchsia, magenta, wine, plum, pearl, rose gold
        Write multi-word names with spaces. Accent or pattern colors use the same vocabulary. These words
        describe COLOR only: rose, peach, lemon, apricot and lilac never mean a flower or fruit motif;
        draw a motif only when the motif array contains it.

        [DESCRIPTION STRUCTURE]
        Per nail, 2-3 sentences when needed. Sentence 1: base color, surface, finish, major pattern.
        Sentence 2: the primary motif or parts with physical material and visual effect. Optional sentence
        3: supporting details, layering, reflective behavior, or how the focal decoration interacts with
        the nail surface. When a motif or part is selected, name it in the description with the exact
        controlled term or a direct natural equivalent, and keep it visually important, not a background
        detail.

        [DESIGN RICHNESS - VERY IMPORTANT]
        SIMPLE MODE is on only when the mood contains "simple" or the user's own words ask for it (심플,
        미니멀, 깔끔, simple, minimal, clean). Without it, the set must look like a real market nail-art
        display sheet: art-driven and varied, never a plain set with a few sprinkled gems. When the user asks
        for "화려하게", "아트적으로" or "포인트" this means MORE NAIL ART (drawn motifs, patterns, french
        variants, washes, 3D pieces), never just more rhinestones, stars or glitter.
        Default (simple mode off):
        - One concept per set, taken from the mood, season, colors, the user's words or the reference image
          (for example ribbon and heart, cherry and strawberry, leopard and check street style, halloween,
          music, cross and chrome, star and butterfly y2k). The five nails are DIFFERENT designs under that
          concept, on soft sheer base colors of one coordinated palette.
        - Art mix: use at least FOUR different art types across the five nails:
          a) hand-drawn doodle motifs in thin smooth lines (bow outline, heart, star, cross, butterfly, cherry,
             strawberry, music notes, small ghost or bat silhouettes for halloween, tiny spiral, small dots or a
             short word), in black, dark brown or a deeper tone of the palette;
          b) pattern nails: leopard print, plaid / gingham check, polka dot, stripe, speckle (leopard and other
             drawn prints use the pattern "line art" or "speckle" and are named plainly in the description);
          c) french variants: thin black french, leopard french, glitter french, double french, V-shaped or
             reversed french, color-tip french;
          d) soft washes: gradient, aura / smoky ink-blot wash, cat-eye glow, marble, blooming dots;
          e) 3D pieces: a polished silver or resin bow charm, a chrome cross, heart or star charm;
          f) one quiet one-color syrup nail (at most one).
        - Each nail has one focal art plus at most TWO supporting accents. At least three nails carry a drawn
          motif or a pattern, at least one nail carries a 3D piece, and at most one nail stays quiet.
        - Rhinestones, pearls, studs and glitter are accents only: at most TWO nails carry a gem cluster and
          never every nail.
        - Drawn motifs and patterns may be medium (up to about half of the nail) and a pattern may cover the
          whole nail; 3D charms and gems stay small (see [REAL SALON REALISM]).
        - Nails that share a design of [THREE-DESIGN ALTERNATING SET] differ in their art.
        Simple mode: roughly 3 to 5 decorative elements in total, at most TWO on any nail, one or two quiet
        nails, and no extra supporting elements.
        In every mode: the user's own selection has priority (create richness with compatible supporting
        elements, materials and finish variation around it, never override it); base designs / patterns are
        limited to three distinct ones in total and do not count toward the element numbers; a funky mood
        overrides the per-nail limit (see [FUNKY MOOD]); do not add an element that clashes with the mood
        merely to reach a count; if the user declined motifs or parts ("none" / "없음") do not add any.

        [MOOD-BASED SUPPORTING ELEMENTS - VERY IMPORTANT]
        The user usually names only one or two elements. Keep them, but do NOT cover all five nails with
        only those. Add supporting elements a real nail artist would pair with the mood, using ONLY
        controlled vocabulary:
        - lovely / feminine / sweet / romantic: lace (pattern); heart charm, pearl bead, pearl trim,
          rhinestone, bow charm 3d (parts); heart (motif); cheek blush or soft french tip (pattern)
        - cute / kitsch / playful: heart, star, bunny (motif); polka dot, plaid, stripe (pattern); heart
          charm, star charm, bow charm 3d, rhinestone (parts)
        - chic / elegant / modern: french tip, line art, color block, blooming (pattern); pearl trim,
          chain, metal stud, rhinestone (parts)
        - cool / edgy / dark / funky: cross, star, butterfly (motif); speckle, marble, blooming (pattern);
          chain, metal stud, star charm (parts)
        - y2k / glam: star, butterfly (motif); rhinestone, star charm, chain (parts); chrome or glitter
          (finish)
        - natural / minimal / vintage: watercolor, gradient, line art (pattern); tiny pearl bead, leaf
          (motif)
        Distribute: the nail with the user's main element is the hero; a second nail carries the user's
        other named element; the remaining nails (all but at most one; in simple mode all but one or two) carry a DIFFERENT
        supporting element or part from the mood list (e.g. a heart charm or a rhinestone cluster). At least one
        supporting element is a motif (heart, star, butterfly), not only a part. Prefer motifs and parts;
        add a new base design / pattern only if the set stays within three distinct base designs. If the
        confirmed input has a "[VARIATION LEAN]" with "supporting elements to try", use those that fit the
        mood. A user-named motif appears on at most three nails, and no two nails have the same
        combination of motif, part and pattern (nails sharing a design differ at least by their accent).
        Every description names its element and, for parts, material, size and color. If the user declined
        motifs or parts ("none" / "없음") or asked for a minimal design, skip this rule.

        [CREATIVE LATITUDE - VERY IMPORTANT]
        Honor every user choice (selected options and own words), the controlled vocabulary and the hard
        rules, but design everything not specified inventively. Do not default to the most obvious
        combination or repeat the same recipe from set to set: vary the hero nail, asymmetry and accent
        placement, scale within limits, accent colors, finish mixes, edge-hugging or corner-cropped art,
        negative space, partial or reversed french tips, color-blocked halves and gradient direction. The
        [THREE-DESIGN PLAN] and [VARIATION LEAN] (including creative twists) are starting points, not
        orders: you may re-assign designs among nails and add unexpected but harmonious ideas. If the same
        selection would produce a set like a previous one, change something visible.

        [DEFAULT COLOR EXPRESSION - SYRUP - VERY IMPORTANT]
        The default color expression of EVERY nail is a syrup color (finish "syrup"): translucent, juicy,
        glass-like syrup gel with pigment suspended in clear gel, the nail bed glowing softly through, and
        a large soft mirror-like highlight on a thick wet-looking surface (the trending Korean syrup-gel
        look). Opaque creamy pastel looks flat and cheap, so never use it by default.
        - It applies to every design: gradient (syrup gradient), marble, french tip, one-color, glitter
          (ultra-fine glitter floating in a syrup base: finish ["syrup", "glitter"]) and powder (a
          pearl-powder glaze over syrup: finish ["syrup", "powder finish"]).
        - Write "syrup" or "translucent syrup gel" in every description with its light transmission and
          glassy depth, as in [TRANSPARENCY AND SYRUP REALISM].
        - Use solid (opaque, no "syrup") only when the user asked for solid / opaque colors or a matte set.
          Magnetic cat eye, knit and ink nails keep their own expression.
        - This default overrides any example below that shows a "solid" nail.

        [STYLE TOOLBOX - MIX PER FINGER - VERY IMPORTANT]
        Build each nail from these four axes (skip an axis when it does not suit the nail). All five nails
        keep the same mood, palette and shape but combine options differently, like a salon display sheet.

        1) Color expression (how the base color looks):
           - syrup: translucent syrup-gel color (finish "syrup"), the DEFAULT for every nail.
           - solid: opaque, even solid color (no color finish), only when the user asks for solid / opaque
             colors or a matte set.
           - magnetic: magnetic gel (finish "magnetic cat eye") rendered by default as a ROUND GLASS-BEAD
             glow: a soft, domed, pearly gleam gathered into a rounded blob in the center of the nail,
             like a glossy glass bead or pearl in clear gel, with a bright clean highlight on top. NOT a
             stripe, band, diagonal line, spiral or swirl. The gleam is SILVER or GOLD (champagne) only,
             never holographic, rainbow or multi-color iridescent, unless the user explicitly asks for a
             combination (e.g. a guava nail: green base with a pink gleam). No visible particles, specks
             or sparkle, so it never looks like glitter.
           - glitter: (finish "glitter") ONLY a sparkle effect: a scattering of tiny bright points of light
             twinkling inside a perfectly smooth, clear, even-colored syrup surface. No texture, pattern,
             grid, net, crackle or background marks; the color underneath stays one smooth clean tone.
             Glints are small, few to moderate, loosely spread, in the nail's own hue family (soft pink,
             rose, silver or champagne); never large flakes, chunks or hexagon confetti. Glitter and
             magnetic are never described with the same wording. Write only the color and "fine sparkle"
             (e.g. "soft pink syrup with fine sparkle"), no grains, dust or texture. A glitter nail is a
             syrup nail with glitter floating inside (finish ["syrup", "glitter"]). Use glitter on at most
             TWO nails (unless the user explicitly asks for more, e.g. all nails), and never describe
             glitter on a nail whose finish array lacks "glitter".
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
           - ink: ink gel (finish "ink"), a DRAWING ELEMENT on top of a base color, not a replacement: every
             ink nail has a base color laid first (by default syrup, so finish ["syrup", "ink"]; a clear or
             sheer natural base is allowed but not the default). Ink is a vivid but fully transparent
             colored gel, like colored glass or marker ink: saturated, see-through, soft-edged. Three uses:
             a) Ink drawing art (the drawing design type): an ink illustration like a cute hand-inked
                sticker. The motif's shapes are FILLED with transparent ink colors (sheer, saturated,
                slightly uneven, watercolor-like) on top of the base, with at most a thin light line in a
                slightly deeper tone of the same hue (no black or heavy dark outline). Small details (a
                knot, folds, a face, stripes) use the same light line. Use one to three harmonious fill
                colors from the palette. The fills are clearly visible and the motif is clearly
                recognizable and fairly large (about half the nail). Never abstract lines, lacing,
                spirals, raised gel lines or pearls instead of a motif. Ink alone (a wash with no motif)
                is not a drawing, so every ink drawing nail carries a motif (ribbon, flower, clover,
                heart, star, lettering, a small cute character). When the user chose the drawing design
                type, use ink on the nails carrying the drawn art and give the other nails syrup or
                another base.
             b) Ink wash: soft ribbon-like or wave-like swaths of one vivid hue painted over part of the
                base with soft, slightly pooled watercolor-like edges (not an airbrush gradient over the
                whole nail, not a blush).
             c) Ink check (gingham): pattern "plaid" with finish "ink": wide see-through stripes of one
                vivid hue in two directions, deeper where they cross, soft hand-painted edges, no dark
                lines.
             Colors are bright and clear: raspberry, rose, coral, orange, yellow, lime, mint, aqua, sky
             blue, cobalt, violet. Ink is glossy only (never in a matte set). Write the base color (e.g.
             "soft pink syrup base") and the ink drawing, wash or check on it.
        2) Parts / motif rendering (how decorations are made):
           - 3D: raised physical decoration of plastic, embossed gel, silver metal, pearl or resin (parts
             "bow charm 3d", "heart charm", "star charm", "pearl bead", "rhinestone", or the finish
             "sculpted 3d" for embossed gel).
           - drawing: a flat hand-drawn motif (motif values such as "bow ribbon", "heart", "flower"; checks
             and lines use pattern "plaid" or "line art"). Two styles, pick one per nail and name it:
              a) doodle drawing: the main hand-drawn art style of market nail sets: a naive, childlike thin-line
                 outline drawing with simple shapes and slightly imperfect proportions, outline only or
                 lightly filled in, in black, dark brown or a deeper tone of the palette, up to about half of
                 the nail (hearts, bows, stars, crosses, butterflies, cherries, strawberries, music notes,
                 tiny spirals, small dots, short words). The shape may be naive but the LINE must be smooth:
                 a solid, evenly colored, evenly glossy stroke like a smooth gel pen, with no grain, bumps,
                 lumps, fuzzy or rope-like texture.
              b) painted flowers only: soft smudged painted blooms per [FLOWER ART RENDERING].
              Every other flat motif (stars, hearts, butterflies, bunnies, crosses, leaves, shells) is EITHER
              a doodle outline (a) OR a raised 3D piece (a part, or finish "sculpted 3d" for embossed gel).
              Ribbons and bows have more options (see [RIBBON / BOW VARIETY]). There is no third option:
              never a shaded, refined, illustrated or semi-realistic drawing, and never a sticker / decal /
              printed clip-art look (a flat glossy printed shape pasted on the nail). Thin gel-pen line
              doodles are the intended style.
        3) Design (the base design of the nail):
           - gradient (pattern "gradient"), cheek (pattern "cheek blush"), ink-blot (pattern "watercolor",
             spreading ink-blot bleed), marble (pattern "marble"), french (pattern "french tip")
           - blooming (pattern "blooming"): a sheer, glossy, translucent base (soft pink, nude, lilac or
             clear) with large soft dots of ink pigment, each a FILLED blob like a drop of ink spreading in
             wet gel: the center is the darkest, most saturated part and the color fades smoothly outward
             into a blurred feathered edge. By default the dots are BIG (each about one fifth to one
             quarter of the nail width) and FOLLOW THE OUTLINE of the nail: a row of dots along the curved
             free edge like a scalloped border, or along one side wall, touching or overlapping so they
             melt into a soft scalloped edge; or a small cluster of four dots forming a blossom near a
             corner or the tip. Not an S-curve and not a chain wandering across the middle. Never a ring,
             donut, hollow or outlined circle, white fluffy puff or halo-only dot. The dots are one hue,
             always a deeper, more saturated tone than the base (e.g. wine, plum or lilac on nude, smoke
             gray on gray), never white, with most of the nail left clean. Blooming suits funky or chic moods, but
             that is only a suggestion: do not put it in every set, and use it only when it genuinely fits the
             set or when the user asks for it by name. In other moods (lovely, cute, sweet, romantic, elegant,
             natural, minimal, vintage, y2k, glam, ...) avoid it unless the user asks. NOT a flower drawing and NOT outlined or polka dots; the spreading dots are the whole
             design of that nail.
        4) Finish (the top surface of the whole set):
           - The whole set is EITHER matte OR glossy, decided once with the top-level "surface". A matte
             set is matte on all five nails (no mixing).
           - Inside a glossy set, individual nails may be plain glossy or powder (finish "powder finish").
           - A matte set uses only solid colors and knit (matte velvet): no syrup, ink, magnetic, glitter
             or powder; variety comes from base design (gradient, cheek, ink-blot, marble, french;
             blooming optionally, mainly for funky or chic moods) and parts / motif rendering.
           - If the user's words say matte or glossy, follow them for the whole set.

        Mixing rules:
        - Example for a lovely cute glossy set (illustration only, do not copy): thumb = syrup + gradient
          + glossy (design A); index = syrup + glitter + glossy (design B); middle = syrup + gradient +
          silver 3D bow + glossy (design A, different accent); ring = syrup one-color + one 3D pearl +
          glossy (design C); pinky = syrup + glitter + glossy with one tiny rhinestone near the cuticle
          (design B). One color expression (syrup); the glitter nails are syrup with glitter inside.
        - LIMIT ON COLOR EXPRESSIONS: syrup is the base of every nail. Besides syrup use at most ONE other
          expression across the set: solid (only when asked), magnetic, knit or ink (when the user chose
          the drawing design type, that expression is ink). The other axes provide the variety.
        - At least three nails differ in at least one axis (the three designs of [THREE-DESIGN ALTERNATING
          SET]); nails sharing a design share its axes but differ by accent. Some nails use only one or two
          axes so the set has quiet and busy nails; do not stack many effects on one nail.
        - LIMIT ON DESIGNS: across the set use at most THREE distinct base designs / patterns (gradient,
          cheek blush, marble, french tip, watercolor / ink-blot, blooming, polka dot, plaid, stripe, line
          art, lace, color block, speckle), counting the user's. Keep it calm: variety comes mostly from
          motifs, parts and color expression. At most one base design per nail.
        - DOTS (polka dot): dots are EITHER the whole design of a nail (evenly spaced dots of one size
          covering the entire nail from cuticle to tip, no other motif, part, wave or ink swath) OR sit only
          inside the french tip area of a french tip nail. Never scatter dots around or between other
          elements: a nail with a motif (cherry, flower, ribbon, heart, ...), a charm, a wave or an ink
          swath has no dots, and a dot nail has no other motif. Dots are simple solid round dots without
          outline (never outlined cartoon circles), written as pattern "polka dot", not as a motif.
        - CHECK (plaid): when check is combined with the drawing design type or a cute mood, every check
          nail is a HAND-DRAWN check: soft translucent color bands in two directions PLUS thin, slightly
          wobbly hand-drawn lines along and across the bands in an accent color of the palette (a deeper
          or contrasting tone), not perfectly straight, with uneven spacing and a few lines slightly
          overlapping or doubled, like a pen sketched over the bands. Write "hand-drawn wobbly check
          lines" in the description.
        - CHEEK BLUSH is only allowed on syrup nails: finish "syrup", never combined with glitter,
          magnetic or a solid opaque base.
        - A nail never combines glitter with another strong effect (cheek blush, magnetic, powder, french
          tip): glitter nails stay simple.
        - SMOOTH LINES: every drawn motif (stars, hearts, ribbons, spirals, dots) is a smooth, even, solid
          stroke with clean edges; never lumpy, bumpy, grainy, rough, beaded, fuzzy or rope-like.
        - COLOR SPREAD: a motif's color stays close to its outline. A soft or watercolor-like motif may
          blur only slightly within a small margin; its color never washes widely across the nail or tints
          the surrounding gel. Aura / watercolor / marble background colors come from a different, subtle
          color family than the motif colors.
        - Keep the user's named elements and fill the other nails by mixing the axes in ways that fit the
          mood.
        - If a "[THREE-DESIGN PLAN]" is present (at the top of these instructions or in the confirmed
          input), use it as the starting point for each nail's color expression, base design and finish
          (matte, glossy or powder), then add the user's named elements and the parts / motif rendering.
          Change it only when it clashes with the mood or the user's words.
        - Name the chosen options in each description (e.g. "syrup base", "doodle bow ribbon", "silver 3D
          heart", "chunky ivory 3D bow") so the image model does not fall back to a default look.

        [SURFACE / FINISH COMPATIBILITY]
        If the top-level surface is matte, do not use glitter, chrome, syrup, ink, magnetic cat eye or
        powder finish on any nail (knit is fine: matte velvet). If it is glossy, all finish values are
        permitted unless another user rule conflicts.

        [USER'S OWN WORDS - HIGHEST PRIORITY]
        If the confirmed input contains the user's own chat messages, every concrete request in it
        (decorations, parts, materials, colors, placement) MUST appear in the output. Never drop, soften
        or replace one, even if it conflicts with "simple", a finish rule or an earlier "none" selection
        (a later explicit request cancels "none"). Map Korean terms to the controlled vocabulary and ALSO
        name the element in the nail descriptions:
        - 큐빅, 스톤, 보석, 크리스탈, 쥬얼 -> parts "rhinestone" (sharp, faceted, sparkling gems)
        - 진주, 펄 비즈 -> parts "pearl bead"
        - 블루밍, 번지는 점 -> pattern "blooming" (spreading ink-like dots, see the blooming design)
        - 리본 입체, 리본 참 -> parts "bow charm 3d"
        - 체인 -> parts "chain"; 메탈 스터드, 징 -> parts "metal stud"
        - 소용돌이, 스월, 스파이럴 -> pattern "line art" (see the spiral rule)
        If the user did not say which fingers, place the element on at least two or three nails as a clear
        focal accent (not on every nail), clustered near the cuticle or tip.

        [USER-SPECIFIED PRIORITY]
        The confirmed input is authoritative. A finger-by-finger design is followed exactly; a
        finger-by-finger exclusion means that element is not used on that finger. If only some fingers are
        specified, keep them exactly as requested and design the rest with the shared palette and mood
        (never leave them empty unless the user asked). If the user combines several styles without
        assigning fingers, distribute them naturally across the five nails.

        [TEXT / LETTERING]
        If the user explicitly asks for a letter, initial or word on a nail, keep the exact characters and
        include the lettering element. Do not invent or modify the text.

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
          "reference_characters": "",
          "thumb": { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "index":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "middle": { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "ring":   { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" },
          "pinky":  { "description": "", "finish": [], "pattern": [], "motif": [], "parts": [], "base_color": "" }
        }
        """;

    private static final String SYSTEM_PROMPT =
            String.join("", SYSTEM_PROMPT_PART1, SYSTEM_PROMPT_PART2, SYSTEM_PROMPT_PART3);

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
            "tonal pink", "dusty mauve", "soft white", "ivory cream", "clear transparent", "silver", "champagne gold",
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
        return !wantsSimple(confirmedInput) || DRAWN_RIBBON_OK.matcher(wantedPart(confirmedInput)).find();
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
            f.put("description", description + " The bow is a small raised 3D bow charm made of smooth glossy pearly resin"
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
     * [현재 호출하지 않음] 펑키/시크 무드를 골랐는데 블루밍(번지는 점) 손톱이 하나도 없으면, 패턴/모티프/파츠가 없는 손톱 최대 2개에
     * 블루밍을 넣던 강제 후처리. 무드가 블루밍을 항상 나오게 하지 않기로 해서 호출을 뺐다(GPT 프롬프트의 힌트로만 남음).
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

    /**
     * 이미지 모델은 참고 이미지를 볼 수 없는데 플래너가 "...of the reference", "from the reference" 같은 문구를 설명에 남기는 경우가 있다.
     * "reference"가 들어간 문장은 쉼표 뒤 꼬리절만 잘라내고(앞 내용이 있으면), 앞 내용이 없으면 문장째 지운다. 다른 문장이 없으면 단어만 바꾼다.
     */
    private static String dropReferenceWording(String description) {
        if (description == null || !description.toLowerCase().contains("reference")) return description;
        StringBuilder out = new StringBuilder();
        for (String sentence : description.split("(?<=[.!?])\\s+")) {
            String low = sentence.toLowerCase();
            if (!low.contains("reference")) {
                if (out.length() > 0) out.append(" ");
                out.append(sentence);
                continue;
            }
            int ref = low.indexOf("reference");
            int comma = sentence.lastIndexOf(',', ref);
            if (comma > 8) {
                if (out.length() > 0) out.append(" ");
                out.append(sentence, 0, comma).append(sentence.endsWith(".") ? "." : "");
            }
            // 쉼표가 없거나 앞 내용이 거의 없으면 문장째 건너뛴다
        }
        String cleaned = out.toString().trim();
        if (cleaned.isEmpty()) {
            return description.replaceAll("(?i)\\b(?:of |from |in )?the reference(?:'s|\u2019s)?(?: image)?", "the mood")
                    .replaceAll("(?i)\\breference image\\b", "mood").trim();
        }
        return cleaned;
    }

    private void stripReferenceWording(JsonNode plan) {
        if (!(plan instanceof ObjectNode root)) return;
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            String d = f.path("description").asText("");
            String cleaned = dropReferenceWording(d);
            if (!cleaned.equals(d)) f.put("description", cleaned);
        }
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
                    ? "glitter nail: finish syrup + glitter - ultra-fine glitter floating inside a syrup base, no base pattern"
                    : "glitter nail: finish glitter on a solid base, no base pattern";
            case "magnetic" -> "magnetic nail: finish magnetic cat eye, no base pattern";
            case "powder" -> syrup
                    ? "powder nail: finish syrup + powder finish - pearl-powder glaze over a syrup base, no base pattern"
                    : "powder nail: finish powder finish on a solid base, no base pattern";
            case "gradient" -> "gradient nail: pattern gradient on a " + base + " base";
            case "marble" -> "marble nail: pattern marble on a " + base + " base";
            case "french" -> "french tip nail: pattern french tip on a " + base + " base";
            case "cheek" -> "cheek blush nail: pattern cheek blush on a syrup base";
            case "knit" -> "knit nail: finish knit - a translucent glossy knit gel one-color nail with thin hair-like fibers"
                    + " floating inside the gel (not a woven fabric look), no glitter, no base pattern";
            case "blooming" -> "blooming nail: pattern blooming - soft filled ink-drop dots (dark center fading outward, deeper tone of the base) in a scalloped row along the nail's free edge on a " + base + " base";
            case "check" -> "check nail: pattern plaid - a gingham check on a " + base + " base (when ink is part of the set it is an"
                    + " ink check: finish syrup + ink)";
            case "ink" -> "ink nail: finish syrup + ink - a syrup base color with ink on top: a hand-drawn motif filled with"
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
        // (블루밍을 펑키/시크 무드에서 무조건 세트에 넣던 것은 없앴다. 아래 보충 풀에서 확률만 살짝 높이는 힌트로만 남긴다.)
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
        // 블루밍은 펑키/시크 계열에 어울려서 그 무드일 때 보충 풀에 조금 더 넣는다(강제 아님, 확률만 살짝 높임).
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
        if (arrayContains(finger.path("finish"), "syrup")) return "syrup";
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
     * 나머지 손톱은 솔리드로 돌린다. 치크 블러시 손톱이 있으면 시럽(syrup)을 남긴다.
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
        // 시럽(syrup)은 기본 베이스라 항상 남기고, 그 외 색 표현(자석/글리터/니트/잉크)은 한 가지만 남긴다(솔리드가 이미 있으면 0).
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
        keep.add("syrup");
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

    private static final java.util.regex.Pattern SYRUP_WORDING = java.util.regex.Pattern.compile("(?i)syrup|translucent");

    private static final String SYRUP_SENTENCE =
            " The base color is a translucent syrup gel: pigment suspended in clear glassy gel with the nail bed"
                    + " color glowing softly through it.";

    /**
     * 컬러 표현의 기본값은 시럽(반투명 젤)이다. 불투명한 파스텔은 납작하고 싸구려처럼 나와서(밤티), 사용자가
     * 솔리드/불투명/매트를 말하지 않았다면 모든 손톱의 베이스를 시럽으로 맞춘다: finish에 "syrup"를 넣고 설명도 시럽 표현으로
     * 보정한다. 글리터/파우더/프렌치 손톱도 시럽 베이스 위에 얹는다. 자석젤/크롬 손톱은 그 효과가 색 표현이라 그대로 둔다.
     * (GPT가 솔리드로 쓴 손톱이 남아 있으면 프롬프트 지시만으로는 기본값이 지켜지지 않아서 코드로도 맞춘다.)
     */
    private void ensureSyrupDefault(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        if (root.path("surface").asText("").toLowerCase().contains("matte")) return;
        if (WANTS_OPAQUE.matcher(wantedPart(confirmedInput)).find()) return;
        for (String finger : FINGERS) {
            if (!(root.path(finger) instanceof ObjectNode f)) continue;
            if (arrayContains(f.path("finish"), "syrup") || arrayContains(f.path("finish"), "magnetic cat eye")
                    || arrayContains(f.path("finish"), "chrome") || arrayContains(f.path("finish"), "knit")) continue;
            addToArray(f, "finish", "syrup");
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
     * - 치크 블러시는 시럽(syrup)에서만: 글리터/자석/크롬 제거, syrup 보장
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
                if (!arrayContains(f.path("finish"), "syrup")) addToArray(f, "finish", "syrup");
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
        System.out.println("[FingerDesignPlan] 컬러 표현(syrup): " + expressions);

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
            int syrupCount = 0, other = 0;
            for (String finger : FINGERS) {
                if ("syrup".equals(colorType(root.path(finger)))) syrupCount++; else other++;
            }
            syrup = syrupCount >= other;
        }

        // 베이스 색: 첫 번째로 값이 있는 손톱의 base_color, 없으면 상위 color
        String base = "";
        for (String finger : FINGERS) {
            String b = root.path(finger).path("base_color").asText("").trim();
            if (!b.isEmpty()) { base = b; break; }
        }
        if (base.isEmpty()) base = root.path("color").asText("").trim();
        base = base.replaceAll("(?i)\\b(base|syrup|solid|opaque|translucent)\\b", "").replaceAll("\\s+", " ").trim();
        if (base.isEmpty()) base = "soft white";

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
            if (syrup) addToArray(f, "finish", "syrup");
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

    // 심플 모드: 무드에 simple이 있거나 사용자가 말로 심플/미니멀을 원할 때만 절제된 세트로 간다. 그 외에는 파츠/디자인을 풍성하게.
    private static final java.util.regex.Pattern SIMPLE_WORDS = java.util.regex.Pattern.compile(
            "simple|심플|미니멀|minimal|깔끔|단정");

    private static boolean wantsSimple(String confirmedInput) {
        return SIMPLE_WORDS.matcher(wantedPart(confirmedInput)).find();
    }

    private static boolean declinedMotifOrParts(String confirmedInput) {
        for (String line : wantedPart(confirmedInput).split("\\R")) {
            if ((line.contains("motif") || line.contains("parts") || line.contains("핵심"))
                    && (line.contains("없음") || line.contains("none"))) return true;
        }
        return false;
    }

    /**
     * 참고 이미지 기반 생성은 변주 힌트와 세 가지 디자인 배치를 쓰지 않아서 결과가 단조로워지기 쉽다.
     * 이미지에서 본 요소를 손톱마다 다른 아트(손그림 낙서, 패턴, 프렌치 변형, 워시, 3D 한두 개)로 나눠 쓰도록 하는
     * 가벼운 힌트만 따로 넘긴다(심플 모드면 생략). 큐빅을 더 뿌리라는 뜻이 아니다.
     */
    private String buildImageRichnessLean(String confirmedInput) {
        if (wantsSimple(confirmedInput)) return "";
        java.util.concurrent.ThreadLocalRandom r = java.util.concurrent.ThreadLocalRandom.current();
        List<String> twists = new java.util.ArrayList<>(LEAN_TWISTS);
        java.util.Collections.shuffle(twists, r);
        return "\n[REFERENCE RICHNESS LEAN] This is a reference-image request and the user did not ask for a simple look: build an"
                + " art-driven, varied set like a market nail-art display sheet. Give the five nails clearly different art under one"
                + " concept taken from the image: hand-drawn thin-line doodle motifs, a pattern nail (leopard, plaid, polka dot or"
                + " stripe), a french variant, a soft wash (gradient, aura, cat-eye) and one or two small 3D pieces. At least three"
                + " nails carry a drawn motif or a pattern, at most one nail stays quiet, and gems or glitter are accents on at most"
                + " two nails (never a character, face or logo). Optional creative twists: " + twists.get(0) + " | " + twists.get(1)
                + ".\n";
    }

    /**
     * 심플 모드가 아닌데 아무 장식도 없는 조용한 손톱이 2개 이상이거나 모티프가 있는 손톱이 3개 미만이면, 비어 있는 손톱에
     * 손그림 낙서 모티프(하트/별/나비/십자가/리본)를 더한다. 시중 네일 아트 시트처럼 손톱마다 다른 그림이 들어가게 하려는 것이라
     * 큐빅 같은 파츠를 더 뿌리지는 않는다. 펑키 무드(enforceFunkyParts가 처리), 원컬러 세트, 모티프/파츠 "없음" 선택은 건드리지 않고,
     * 도트/블루밍/잉크 손톱과 캐릭터 손톱도 그 디자인이 전부라 건드리지 않는다. 리본은 세트에 이미 리본이 있으면 쓰지 않는다(리본 룩은 하나).
     */
    private void enforceRichness(JsonNode plan, String confirmedInput) {
        if (!(plan instanceof ObjectNode root)) return;
        if (wantsSimple(confirmedInput) || declinedMotifOrParts(confirmedInput)) return;
        if (FUNKY_WORDS.matcher(wantedPart(confirmedInput)).find()) return;
        String[] motifs = {"heart", "star", "butterfly", "cross", "bow ribbon"};
        String[] sentences = {
                " A small hand-drawn doodle heart in a thin smooth gel-pen line in a deeper tone of the base sits off-center near the tip.",
                " A small hand-drawn doodle star in a thin smooth deeper-tone line sits near a side edge.",
                " A small hand-drawn doodle butterfly in a thin smooth deeper-tone line sits near the cuticle.",
                " A small thin-line doodle cross in a deeper tone sits off-center on the nail.",
                " A small hand-drawn line-art bow in a thin smooth deeper-tone line sits near the cuticle."};
        java.util.Set<String> used = new java.util.HashSet<>();
        boolean ribbonInSet = false;
        int motifNails = 0, quiet = 0;
        for (String finger : FINGERS) {
            JsonNode f = root.path(finger);
            boolean hasMotif = false;
            for (JsonNode m : f.path("motif")) {
                String v = m.asText("").trim().toLowerCase();
                if (!v.isEmpty() && !v.equals("none")) { hasMotif = true; used.add(v); }
            }
            if (arrayContains(f.path("motif"), "bow ribbon") || arrayContains(f.path("parts"), "bow charm 3d")) ribbonInSet = true;
            if (hasMotif) motifNails++;
            if (isQuietNail(f)) quiet++;
        }
        if (quiet <= 1 && motifNails >= 3) return;
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < motifs.length; i++) {
            if (ribbonInSet && motifs[i].equals("bow ribbon")) continue;
            order.add(i);
        }
        java.util.Collections.shuffle(order, java.util.concurrent.ThreadLocalRandom.current());
        order.sort((x, y) -> Boolean.compare(used.contains(motifs[x]), used.contains(motifs[y])));
        // 조용한 손톱부터 채운다.
        List<ObjectNode> candidates = new ArrayList<>();
        for (int pass = 0; pass < 2; pass++) {
            for (String finger : FINGERS) {
                if (!(root.path(finger) instanceof ObjectNode f)) continue;
                if (f.path("motif").isArray() && f.path("motif").size() > 0) continue;
                if (arrayContains(f.path("pattern"), "polka dot") || arrayContains(f.path("pattern"), "blooming")
                        || arrayContains(f.path("finish"), "ink") || candidates.contains(f)) continue;
                if ((pass == 0) == isQuietNail(f)) candidates.add(f);
            }
        }
        int added = 0;
        for (ObjectNode f : candidates) {
            if (quiet <= 1 && motifNails >= 3) break;
            if (order.isEmpty()) break;
            int k = order.get(added % order.size());
            boolean wasQuiet = isQuietNail(f);
            addToArray(f, "motif", motifs[k]);
            f.put("description", f.path("description").asText("") + sentences[k]);
            if (wasQuiet) quiet--;
            motifNails++;
            added++;
        }
        if (added > 0) System.out.println("[FingerDesignPlan] 심플 모드 아님 → 손톱 " + added + "개에 손그림 모티프를 추가(모티프 있는 손톱 "
                + motifNails + "개, 조용한 손톱 " + quiet + "개)");
    }

    /** 모티프, 파츠, 패턴, 색 효과가 하나도 없는 손톱. */
    private static boolean isQuietNail(JsonNode f) {
        for (JsonNode m : f.path("motif")) {
            String v = m.asText("").trim().toLowerCase();
            if (!v.isEmpty() && !v.equals("none")) return false;
        }
        if (f.path("parts").isArray() && f.path("parts").size() > 0) return false;
        if (f.path("pattern").isArray() && f.path("pattern").size() > 0) return false;
        for (String effect : List.of("glitter", "magnetic cat eye", "powder finish", "knit", "ink", "sculpted 3d", "chrome", "foil")) {
            if (arrayContains(f.path("finish"), effect)) return false;
        }
        return true;
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
            "(?i)\\b(?:translucent\\s+)?(?:syrup)(?:\\s+(?:gel|base|color))?\\b");

    /** 사용자가 드로잉을 골랐을 때(매트 제외) 그림이 들어가는 손톱의 베이스는 잉크라는 지시. */
    private static String inkForDrawingLine(String confirmedInput) {
        if (!wantsInk(wantedPart(confirmedInput))) return "";
        return "\n[DRAWING = INK ILLUSTRATION - VERY IMPORTANT] The user chose drawing. A drawing is an ink illustration like a cute"
                + " hand-inked sticker: the motif's shapes are FILLED with transparent ink gel colors (finish \"ink\") - sheer,"
                + " saturated, slightly uneven watercolor-like color areas - on top of a normal base color (syrup by default:"
                + " finish \"syrup\" plus \"ink\"), with at most a thin light line in a slightly deeper tone (no black or heavy"
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
            // 잉크는 베이스 색 위에 얹는 드로잉 요소다: 시럽 베이스(syrup)를 남기고(없으면 넣고) 잉크를 더한다.
            if (!WANTS_OPAQUE.matcher(wantedPart(confirmedInput)).find() && !arrayContains(f.path("finish"), "syrup")) {
                addToArray(f, "finish", "syrup");
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
        boolean editRequest = previousPlanJson != null && !previousPlanJson.isBlank();
        String variationLean = (uniformSet || editRequest) ? ""
                : hasImage ? buildImageRichnessLean(confirmedInputSummary)
                : buildVariationLean(confirmedInputSummary);
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
            stripReferenceWording(plan);
            if (!hasImage && (previousPlanJson == null || previousPlanJson.isBlank()) && !scanAutoMode)
                enforceNoDrawnRibbon(plan, confirmedInputSummary);
            if (!hasImage && (previousPlanJson == null || previousPlanJson.isBlank()) && !scanAutoMode) {
                enforceDotRules(plan, confirmedInputSummary);
                enforceHandDrawnCheck(plan, confirmedInputSummary);
                enforceFunkyParts(plan, confirmedInputSummary);
            }
            // 심플 키워드가 없으면 파츠/디자인을 풍성하게 - 참고 사진 기반 생성도 포함한다(수정 흐름과 원컬러 세트는 제외).
            if (!editRequest && !uniformSet) enforceRichness(plan, confirmedInputSummary);
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