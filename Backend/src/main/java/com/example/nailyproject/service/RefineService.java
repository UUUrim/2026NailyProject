package com.example.nailyproject.service;

import com.example.nailyproject.dto.response.DesignGenerateResponseDto;
import com.example.nailyproject.dto.SlotData;
import com.example.nailyproject.entity.*;
import com.example.nailyproject.repository.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.regex.Pattern;

/**
 * 채팅으로 들어온 수정 요청을 GPT로 처리한다 (POST /chats/{sessionId}/refine).
 *
 * 1. GPT(chat)가 수정 지시문(editInstruction)과 세션 슬롯/손가락별 지정 변경을 JSON으로 만든다.
 * 2. 원본 이미지(S3) 전체 + 이 지시문 하나를 gpt-image의 이미지 편집(images/edits)에 그대로 보내서
 *    수정된 이미지를 받는다. 마스크나 디텍션 서버는 쓰지 않으므로, 지시문 안에 "무엇을 바꿀지"와
 *    "나머지는 그대로 둘 것"을 함께 적어서 다른 영역이 바뀌지 않게 한다.
 * 3. 결과를 새 NailDesign으로 저장하고 채팅 이력을 남긴다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class RefineService {

    /** 수정 결과를 투명 배경으로 받을 때 지시문 뒤에 붙인다: 입력의 흰 배경을 다시 그리지 않고, 손톱은 꽉 찬 불투명으로 둔다. */
    private static final String TRANSPARENT_EDIT_SUFFIX =
            " Return the result as a cut-out on a fully transparent background (no white or colored backdrop, "
                    + "no cast shadow), and keep the silhouette of every nail fully solid and unchanged from the original photo.";

    private final DesignSessionRepository designSessionRepository;
    private final NailDesignRepository nailDesignRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final S3Service s3Service;
    private final ObjectMapper objectMapper;
    private final NailDesignService nailDesignService;
    private final GptClientService gptClientService;

    private static final Pattern HEX_PATTERN = Pattern.compile("^#[0-9A-Fa-f]{6}$");

    /**
     * 수정 지시문(editInstruction) 생성용 시스템 프롬프트.
     * 디텍션 서버로 영역을 마스킹하지 않고, 원본 이미지 전체 + 이 지시문 하나를
     * gpt-image edit API에 그대로 넘기므로, "무엇을 바꿀지"와 "나머지는 절대 그대로
     * 둘 것"을 반드시 한 문장 안에 명시적으로 담아야 한다 — 마스크가 없으니 지시문이
     * 불명확하면 관련 없는 부분까지 바뀔 위험이 있다.
     */
    private static final String GPT_IMAGE_EDIT_SYSTEM_PROMPT_TEMPLATE = """
            You write the "edit instruction" (editInstruction) that is sent to an image-editing AI
            (gpt-image) to modify an already finished press-on nail design image. No region is masked
            this time: the image-editing AI receives the WHOLE original image plus this one instruction.
            Therefore the instruction must state, inside ONE English sentence group, both WHAT to change
            and that EVERYTHING ELSE must stay exactly the same. Without a mask, a vague instruction can
            change unrelated parts of the image.

            The user writes in Korean. Always write editInstruction in English.

            [The actual current image - MOST IMPORTANT]
            The CURRENT image is attached to the user's message. LOOK at it and treat it as the single
            source of truth for what is on each nail. The text below (the original prompt and the
            previous plan) is only a rough hint: the image generator does not follow the plan exactly,
            so a nail the plan describes with a certain element may not actually show it, and the
            element may appear on different nails than the plan says. Count the nails from the left
            (1st to 5th) in the picture itself and decide the target nails from what you actually see.

            [Prompt that was used to generate the original image - hint only]
            %s

            [Previous per-finger plan - hint only, may not match the picture]
            %s

            [Conversation so far - VERY IMPORTANT]
            The user's new message may refer to earlier turns ("아니 다 없애란 말은 아니었는데", "아까처럼 해줘",
            "그거 말고", "다시 원래대로"). Read this history to understand what the previous edit changed and
            what the user means now. The CURRENT image already contains the result of the previous edit.
            If the user says the previous edit went too far or was not what they meant, bring back PART of what
            was removed or changed (use the original prompt, the previous plan and the earlier edit
            instructions below to know what used to be there), in the way the user now describes - do not ask what they meant unless it is truly
            ambiguous. Treat earlier requests as still valid unless the user takes them back.
            %s

            [Finger -> position in the image - VERY IMPORTANT]
            The original image shows five nail tips lined up horizontally, from left to right:
            thumb  = 1st (first from the left; Korean: 엄지)
            index  = 2nd (Korean: 검지, 둘째)
            middle = 3rd (Korean: 중지, 셋째)
            ring   = 4th (Korean: 약지, 넷째)
            pinky  = 5th (rightmost; Korean: 소지, 새끼, 다섯째)
            Users may also refer to a nail by number counted from the left: "1번"/"첫번째" = 1st,
            "2번" = 2nd, "3번" = 3rd, "4번" = 4th, "5번" = 5th. "엄지랑 소지" means thumb and pinky.

            [Nail orientation in the image - VERY IMPORTANT]
            Every nail tip in the image is oriented vertically the same way: the free edge (the tip
            end, which is pointed, tapered or flat depending on the shape) points straight DOWN toward
            the bottom of the frame, and the wider cuticle end is at the TOP. A nail "shape" (round,
            oval, almond, square, stiletto, ballerina) describes ONLY the free edge, i.e. the bottom
            end. The cuticle end at the top is always a soft rounded arc, whatever the shape is.

            [When NOT to edit - VERY IMPORTANT]
            editInstruction is sent straight to the image model, which draws whatever it reads. So it
            must contain ONLY a concrete edit command, never an apology, a refusal, a question, an
            explanation or a note to the user. If the user's message is not a concrete request you can
            turn into a visible change - for example a question, small talk, a complaint, slang or a
            term you cannot translate into concrete colors/finish/decorations (such as an unfamiliar
            mood word), or a request too vague to know what to change - do NOT edit: set
            "isEditRequest" to false, set "editInstruction" to an empty string, and write a short,
            friendly KOREAN message for the user in "replyToUser". In that message say what you did not
            understand and ask for something concrete, with one or two examples, e.g. "'멀멀한'이
            어떤 느낌인지 정확히 모르겠어요. 색을 더 연하게/진하게, 글리터 추가·삭제, 특정 손가락 장식
            변경처럼 구체적으로 알려주실래요?". When the request is a clear edit, set "isEditRequest" to
            true and "replyToUser" to an empty string.
            When "isEditRequest" is false, also fill "replyOptions" with 3 to 4 short KOREAN sentences
            (each under 20 characters) that the user could click to send as their next request. Each one
            must be a concrete, ready-to-use edit request relevant to the current image and to what the
            user seemed to want, e.g. "전체적으로 색을 더 연하게", "글리터 추가해줘", "약지 장식 바꿔줘".
            When "isEditRequest" is true, set "replyOptions" to an empty array.

            [Three kinds of edit requests - VERY IMPORTANT]
            Before writing editInstruction, decide which kind the user's request is. This decides how
            much of the rest you lock down.

            A) Local edit - the user changes a specific element on specific finger(s).
               Examples: "change the heart to a star", "make only the ring finger a deeper color",
               "add a ribbon to the index finger".
               -> Lock EVERYTHING outside the targeted finger(s): colors, shapes, decorations,
                  background, lighting and composition stay identical to the original.

            B) Whole-set style/mood change - the user does not name a finger and asks to change the
               feel, tone or mood of all five nails.
               Examples: "make the overall mood cute", "make it more sophisticated", "calmer vibe".
               -> Here colors, patterns, decorations and finish are all allowed to change. If you lock
                  "everything else including colors", the result barely changes. Lock ONLY the nail
                  shape, the number and left-to-right order of the five nails, the white background,
                  the lighting and the composition; state that the rest (color feel, shape or tone of
                  motifs and parts, patterns, finish) may change freely to fit the requested mood.

            C) Nail shape change - the user asks to change the nail shape itself.
               Examples: "change the shape to square", "make them almond", "쉐입을 스퀘어로 바꿔줘".
               -> Only the free edge (bottom end) is reshaped. The cuticle end at the top MUST keep its
                  original soft rounded curve. Colors, decorations, background, lighting and
                  composition stay identical. Read the current shape from the original prompt or the
                  previous plan (the "shape" field).

            [How to write editInstruction - VERY IMPORTANT]

            A) For a local edit, follow this structure:
            "In this five-nail press-on nail set product photo, on the {Nth} nail tip from the left
            (the {finger} finger), {describe the change concretely}. Do not change anything else - keep
            the other four nail tips, their shapes, colors, and decorations, the overall nail shape,
            the white background, the lighting, and the composition exactly identical to the original
            image."
            - Use the position table above for {Nth} and {finger}. If several fingers change, put them
              in one sentence: "on the 2nd and 4th nail tips from the left (the index and ring fingers)".
            - If the user does not name a finger but asks to change one specific element (a part, a
              color, a motif, etc.), look at the image and find EVERY nail that actually shows that
              element, then pin ALL of those positions explicitly. Example: if stars appear on the
              1st, 3rd and 5th nails and the user says "change the stars to hearts", write "on the
              1st, 3rd and 5th nail tips from the left (the thumb, middle and pinky fingers), replace
              each star motif with a heart motif of the same size and position". Never stop at the
              first match, and never pick a nail that does not show the element. Without a mask, an
              unspecified or incomplete position risks changing the wrong nails or the whole image.
              Only if the element truly cannot be found in the image, pick the single most likely
              nail.
            - When several nails change, describe each change in one sentence group and say it applies
              to each of them; keep the replaced element's size, position and style on each nail
              ("of the same size and position").
            - Only apply what the user asked for. Never tell the model to change elements the user did
              not mention (other parts, base color, patterns, ...).
            - SCOPE OF A LOCAL EDIT - VERY IMPORTANT: change ONLY the element the user named (a motif,
              a charm, a line, a part ...). Unless the user explicitly asks to change that nail's base
              color, finish, glitter or surface texture, add a sentence that says the targeted nail's
              base color, finish, glitter/texture and shape stay exactly as they are and that only
              the named element changes. Never add base-color, finish or texture changes on your own.
            - COPYING FROM ANOTHER NAIL - VERY IMPORTANT: when the user says things like "make the 4th
              swirl like the 1st" or "give the 3rd nail the same star as the 5th", copy ONLY the
              element the user pointed at: its form (shape, size, line thickness, number of turns,
              placement). Do NOT copy the source nail's base color, finish, glitter or texture, and
              do not write "including the same base" or "identical in color" for the whole nail. Keep
              the target nail's own base. Keep the element's color as the target nail's current
              motif color, unless the user asks for the same color; a copied color that would be
              nearly invisible on the target nail's base must not be used. State in the sentence which
              attributes are copied and which stay, for example: "redraw the swirl on the 4th nail
              with the same round spiral form, size, line thickness and placement as the swirl on the
              1st nail, keeping the 4th nail's own base color, finish and its current swirl color".

            B) For a whole-set style/mood change, follow this structure:
            "In this five-nail press-on nail set product photo, restyle all five nail tips to clearly
            read as {the requested mood in concrete visual language, e.g. a cute, kawaii, playful feel}
            - {how color feel, patterns, decorations and finish change to fit that mood, see the rules
            below}. Keep the nail shape, the number and left-to-right arrangement of the five nail
            tips, the white background, the lighting, and the overall composition exactly the same as
            the original image."
            - Use ONE intensity modifier throughout. Do not mix opposite strengths such as
              "noticeably" and "subtly" in the same sentence.
            - Do not assume every nail already has a certain decoration (for example "adjust the
              crystal motifs"). Some nails have none, so use broad wording such as "the color feel and
              decorations overall" so that color, tone or finish changes alone can also shift the mood.
            - The only things that must stay the same are: nail shape, the count and order of the five
              nails, the white background, the lighting and the composition. Mention only these five as
              "exactly the same".
            - BE ASSERTIVE - VERY IMPORTANT: never use hedging words such as "consider adding",
              "where suitable", "if possible", "may". The image model treats them as optional and often
              changes almost nothing. Instead state concrete actions: "add small heart charms to two of
              the nails", "give each nail a soft pastel base".
            - GORGEOUS / ART-LIKE REQUESTS - VERY IMPORTANT: when the user asks for "화려하게", "아트적으로",
              "포인트 많이", "더 예쁘게", "gorgeous", "more artistic" or similar without naming an element, they
              mean more NAIL ART like a real market nail-art display sheet, NOT more rhinestones, stars or
              glitter scattered over the same nails. Write concrete actions that give the five nails clearly
              DIFFERENT art: hand-drawn thin-line doodle motifs (bow outline, hearts, stars, crosses,
              butterflies, cherries, music notes) in black, dark brown or a deeper tone of the nail's own color
              on some nails; one or two pattern nails (leopard print, plaid check, polka dots or stripes); a
              french-tip variant (thin black french, leopard french, glitter french or double french) on one
              nail; a soft wash such as a smoky aura gradient or cat-eye glow on one nail; and one or two small
              raised 3D charms such as a polished silver bow or a chrome cross. Drawn motifs and patterns may
              be medium sized (up to about half of the nail). Gem or glitter accents appear on at most two
              nails and are never the main change. Keep it as one coordinated set in the original color family.
            - KEEP COLORS CLOSE TO THE ORIGINAL - VERY IMPORTANT: unless the user explicitly asks for a
              color change, do not tell the model to move to a different color family (for example
              "shift the color palette toward pastel tones"). Keep each nail's original color family and
              allow only a very slight brightening or softening, e.g. "keep each nail's original base
              color family, only brightening or softening it very slightly to feel more playful,
              without shifting to a different color family". Create the mood mainly through the shape
              and feel of motifs, decorations and finish, so the colors look almost the same as the
              original. Change the color family itself only when the user directly asks for a color
              change.
            - ONLY BUILDABLE MOTIFS AND CHARMS - VERY IMPORTANT: describe added motifs or charms only as
              small, simple things a nail salon can really attach (small hearts, stars, ribbons, pearl
              beads, or flat artwork). Do not describe specific characters or faces such as "adorable
              animal faces", or elaborate unrealistic sculptures; the image model may draw them as
              bizarre shapes that cannot be made in reality. The only exception is a character the
              user explicitly asks for, see [Character faces on request] below.

            [Character faces on request - VERY IMPORTANT]
            The design may have been made from a reference photo (a poster, a character illustration,
            ...). By default that photo only set the mood, so the current image has no character face.
            If the user's message explicitly asks to put the character, its face or its figure on the
            nails (for example "캐릭터 얼굴 넣어줘", "나루토 얼굴 넣어줘", "그 캐릭터 그려줘"), this is a
            clear edit request (A, local edit): add that character on the nail(s) the user named, or on
            one or two nails as an accent when no nail is named.
            - BLEND IT IN - VERY IMPORTANT: the character must look like part of that nail's own
              design, never a sticker, decal or printed picture laid on top. Write the instruction so
              that the character is hand-painted nail art in the same style as the existing nail: drawn
              with the same gel-paint look, softly sealed under the same glossy top coat so the nail's
              reflections and light streaks run across it, its colors gently tinted by the nail's base
              color (for example a slightly icy, bluish white on a blue nail instead of a pure
              paper-white cut-out), with soft edges and no hard white outline or drop shadow. Choose a
              size that is balanced with the nail's other decorations, simplified and cute, and place
              it with the existing decorations in mind: tuck it beside or among them, let neighbouring
              elements (for example snowflakes, pearls, stars) overlap or surround it a little, and
              leave the nail's own design visible around it. Do not centre a big face over everything
              and do not hide or erase the existing decorations to make room.
            - Which character: use, in this order, the name the user gave in the message, the
              "reference_characters" field of the previous plan (English names and looks of the
              characters in the reference photo), the "reference_subject" field (Korean name of the
              work or character), and the reference photo itself when a second image is attached to
              the user's message (that second image is the original reference photo the design was
              made from; the first image is the current design). "Put the character on it", "그냥
              이미지 캐릭터를 넣어줘" and similar wording mean the characters of that reference
              photo, so never ask the user which character they mean when any of these tells you.
              Write the English name in editInstruction with a short phrase (about 15 words) for
              its face: signature colors, ear or head shape, a few key features. Keep the colors
              accurate.
            - Send the reference photo to the image editor: when a second image (the reference
              photo) is attached to the user's message, set "useReferenceImage" to true. The image
              editor then receives the current design first and the reference photo second, so
              editInstruction must say so. Still begin editInstruction with "In this five-nail
              press-on nail set product photo (the first image), ...", then add the sentence: "The
              second image is a reference photo of the character; copy ONLY the character's face and
              drawing style from it, nothing else from that photo (not its layout, background,
              colors or other elements)." For every other kind of edit set "useReferenceImage"
              to false. If the photo shows several characters and the user did not
              pick one, choose the one or two main characters; do not draw all of them.
            - Only if none of these sources gives a character (no reference photo, empty fields, and
              the message names no character), do not guess: set "isEditRequest" to false and ask in
              "replyToUser" (Korean) which character they mean.
            - Keep the nail's base color, finish, shape and its other decorations unchanged; only the
              character is added, blended in as described above. The five nail tips must keep the
              same size, position and framing in the picture as in the original image. Add the character to slotActions as {"category": "motif",
              "action": "append_like", "value": "character"} and to keywordsAdd (for example
              "character art").
            If the user only asks for a mood, color or decoration change and does not ask for the
            character, never add a character or a face.

            C) For a nail shape change, follow this structure:
            "In this five-nail press-on nail set product photo, reshape ONLY the free edge (the tip end
            at the bottom of each nail) of all five nail tips from {current shape} to {new shape}:
            {free-edge description from the table below}. The cuticle end at the top of each nail must
            keep exactly its original soft, rounded curve - do not square off, flatten or point the
            top. Keep each nail's width, overall length, colors, decorations, the number and
            left-to-right order of the five nail tips, the white background, the lighting, and the
            composition exactly identical to the original image."
            Free-edge descriptions:
            - round: the free edge is a soft, evenly rounded curve with no corners
            - oval: the free edge is an elongated, smooth oval curve
            - almond: the sides taper gently toward a softly rounded tip
            - square: the free edge is flat and straight across, with defined squared corners
            - stiletto: the sides taper to a sharp, pointed tip
            - ballerina: the sides taper toward a flat, narrower free edge with squared corners
              (also called coffin)
            - If the user asks for a shape change on only some fingers, say so explicitly with the
              position wording from the table above; otherwise apply it to all five.
            - For a shape change, set "newShape" in the JSON to the new shape keyword (one of: round,
              oval, almond, square, stiletto, ballerina) and also add a slotActions entry
              {"category": "shape", "action": "add_like", "value": "<new shape>"}. For every other
              kind of edit, set "newShape" to null.

            [slotActions - VERY IMPORTANT]
            The result screen shows keywords taken from these slots, so after your edit the slots must
            describe exactly what the FINAL image contains. Write one slotActions entry for every
            element the user adds, removes or replaces in this request. Categories: mood, designType,
            color, season, motif, shape. Actions:
            - "append_like": ADD a value and keep the existing ones. Use it when something is added to
              the design: a new motif/part (star, heart, ribbon, pearl, swirl ...), an additional
              color, an additional mood or design type.
            - "remove_like": REMOVE a value that is no longer in the design (e.g. "remove the hearts").
            - "add_like": REPLACE the whole category with this single value. Use it only for single-
              choice categories (shape, season), or when the user clearly swaps everything in a category.
            - "add_dislike": the user does not want this value.
            Rules: use short English keywords for values ("heart", "star", "ribbon", "swirl", "pearl");
            a color value must be a hex code (#RRGGBB); one motif per entry (add "heart" and "star" as
            two entries); do not include categories the request did not touch.
            Examples:
            - "add one more star to the ring finger"   -> {"category": "motif", "action": "append_like", "value": "star"}
            - "add heart drawings to thumb and pinky"  -> {"category": "motif", "action": "append_like", "value": "heart"}
            - "remove the stars"                       -> {"category": "motif", "action": "remove_like", "value": "star"}
            - "change the shape to square"             -> {"category": "shape", "action": "add_like", "value": "square"}
            A request with several changes needs several entries, e.g. "square shape, one more star on
            the ring finger, hearts on the thumb and pinky" -> shape square (add_like), motif star
            (append_like), motif heart (append_like).

            [fingerOverrides / fingerDislikes]
            Same as before; they update the per-finger session state.

            [keywordsAdd / keywordsRemove]
            The result page shows short English keyword chips describing the whole nail set (for
            example "syrup", "chrome", "line art", "watercolor", "gradient", "foil", "heart charm",
            "pearl"). After your edit, list in "keywordsAdd" the 0 to 4 chips that the edit newly adds
            to the set (a finish, pattern, motif or decoration that now visibly exists), and in
            "keywordsRemove" the chips that no longer apply because the edit replaced or removed them
            (e.g. replacing hearts with stars: add "star charm", remove "heart"). Use 1 to 3 plain
            lowercase words in the same style as the examples. Only list things that really change;
            use empty arrays for an edit that only tweaks a shade, size or position.

            Respond ONLY with the JSON below. No markdown, pure JSON only.
            {
                "isEditRequest": true,
                "replyToUser": "",
                "replyOptions": [],
                "keywordsAdd": ["star charm"],
                "keywordsRemove": ["heart"],
                "newShape": null,
                "useReferenceImage": false,
                "editInstruction": "In this five-nail press-on nail set product photo, on the 4th nail tip from the left (the ring finger), replace the heart charm with a star charm. Do not change anything else - keep the other four nail tips, their shapes, colors, and decorations, the overall nail shape, the white background, the lighting, and the composition exactly identical to the original image.",
                "slotActions": [
                    {"category": "motif", "action": "remove_like", "value": "heart"},
                    {"category": "motif", "action": "append_like", "value": "star"}
                ],
                "fingerOverrides": {"ring": "star charm instead of heart charm"},
                "fingerDislikes": {"ring": ["heart"]}
            }
            """;

    /**
     * 채팅 수정 요청 처리 메인 메서드.
     * POST /chats/{sessionId}/refine
     */
    public DesignGenerateResponseDto applyRevision(User user, Long sessionId, String message) throws Exception {
        DesignSession session = designSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new IllegalArgumentException("해당 채팅 세션을 찾을 수 없습니다."));

        chatMessageRepository.save(ChatMessage.builder()
                .session(session).role(ChatMessage.MessageRole.user).content(message).build());

        // 직전 생성 디자인 로드
        NailDesign prevDesign = nailDesignRepository
                .findTopBySessionIdOrderByGeneratedAtDesc(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("수정할 디자인이 없습니다."));

        String originalPrompt = session.getGeneratedPrompt() != null
                ? session.getGeneratedPrompt() : prevDesign.getPromptSummary();
        String previousPlanJson = prevDesign.getDesignPlan() != null
                ? prevDesign.getDesignPlan() : "(직전 플랜 없음)";

        // 1. 현재(원본) 이미지를 S3에서 받는다 - GPT가 실제 그림을 보고 어느 손톱인지 판단하게 하고,
        //    이어서 이미지 편집(gpt-image)의 입력으로도 쓴다.
        String originalImageUrl = prevDesign.getImageUrls().get(0);
        byte[] originalImageBytes = s3Service.downloadImageBytes(originalImageUrl);
        if (originalImageBytes == null) {
            throw new IllegalStateException("원본 이미지를 불러오지 못했어요.");
        }

        // 2. GPT(vision)로 수정 지시문(editInstruction) 생성 - 이전 플랜 텍스트만 보면 실제 그림과 달라서
        //    엉뚱한 손톱을 고르는 문제가 있어, 이미지를 함께 보내 "보이는 대로" 판단하게 한다.
        // 이전 대화(사용자의 수정 요청/답변)와 앞선 수정 지시문(프롬프트) 내역을 텍스트로 GPT에게 같이 보여줘서,
        // "아니 다 없애란 말은 아니었는데"처럼 앞선 수정을 가리키는 말을 이해하게 한다. (이미지는 현재 이미지 한 장만 보낸다)
        List<NailDesign> designsInSession = nailDesignRepository.findBySessionIdOrderByGeneratedAtAsc(sessionId);
        String conversationContext = buildConversationContext(session, message, designsInSession, prevDesign);
        String systemPrompt = String.format(GPT_IMAGE_EDIT_SYSTEM_PROMPT_TEMPLATE,
                originalPrompt, previousPlanJson, conversationContext);
        String originalImageBase64 = Base64.getEncoder().encodeToString(originalImageBytes);
        // 사진 기반으로 만든 세션이면 원본 참고 사진도 두 번째 이미지로 함께 보낸다.
        // ("그 캐릭터 넣어줘"가 어떤 캐릭터인지 GPT가 알 수 있게 하기 위함. 현재 디자인 이미지가 항상 첫 번째)
        List<String[]> visionImages = new ArrayList<>();
        visionImages.add(new String[]{originalImageBase64, "image/png"});
        byte[] referenceBytes = null; // 이미지 편집에도 넘길 수 있게 유지한다 (useReferenceImage)
        String referenceUrl = session.getReferenceImageUrl();
        if (referenceUrl != null && !referenceUrl.isBlank()) {
            try {
                referenceBytes = s3Service.downloadImageBytes(referenceUrl);
                if (referenceBytes != null) {
                    String refMime = referenceUrl.toLowerCase().contains(".png") ? "image/png" : "image/jpeg";
                    visionImages.add(new String[]{Base64.getEncoder().encodeToString(referenceBytes), refMime});
                }
            } catch (Exception e) {
                System.err.println("[RefineService] 참고 이미지 로드 실패, 현재 이미지만 사용: " + e.getMessage());
            }
        }
        String aiText = gptClientService.chatWithImages(systemPrompt, message, visionImages, 4096, true);

        JsonNode resultJson;
        try {
            resultJson = objectMapper.readTree(aiText);
        } catch (Exception e) {
            System.err.println("[RefineService] gpt-image 수정 지시문 JSON 파싱 실패: " + aiText);
            throw new IllegalStateException("수정 내용을 이해하지 못했어요. 다시 말씀해 주세요.");
        }

        boolean isEditRequest = resultJson.path("isEditRequest").asBoolean(true);
        String editInstruction = resultJson.path("editInstruction").asText("").trim();
        String replyToUser = resultJson.path("replyToUser").asText("").trim();
        System.out.println("[RefineService] (gpt-image) isEditRequest=" + isEditRequest
                + " editInstruction: " + editInstruction);

        // 수정 요청이 아니거나(질문/잡담/모르는 표현), 지시문이 비었거나, 지시문 형식이 아니면(사과/거절 문장 등)
        // 이미지 편집을 부르지 않는다. 그 문장이 그대로 이미지 모델에 가면 사진 위에 설명 그림을 그려 버린다.
        // 안전장치로 프롬프트가 요구한 문장 시작("In this five-nail ...")인지도 확인한다.
        // 참고 사진을 같이 보내는 수정은 "The first image is the nail set to edit..."로 시작할 수 있어서 그 시작도 허용한다.
        String instructionLower = editInstruction.toLowerCase();
        boolean looksLikeInstruction = instructionLower.startsWith("in this five-nail")
                || instructionLower.startsWith("the first image is the nail set");
        if (!isEditRequest || editInstruction.isBlank() || !looksLikeInstruction) {
            String reply = replyToUser.isBlank()
                    ? "어떻게 바꾸고 싶으신지 정확히 이해하지 못했어요. 바꾸고 싶은 색, 장식, 위치를 구체적으로 알려주실래요? "
                    + "(예: \"약지 하트를 별로 바꿔줘\", \"전체적으로 색을 더 연하게\")"
                    : replyToUser;
            return replyWithoutEdit(session, prevDesign, reply, parseReplyOptions(resultJson.path("replyOptions")));
        }

        // 쉐입 변경 요청이면 새 쉐입 키워드(round/oval/almond/square/stiletto/ballerina)
        String newShape = normalizeShape(resultJson.path("newShape").asText(""));
        System.out.println("[RefineService] newShape: " + newShape);

        // 세션 슬롯/손가락별 지정 업데이트 (이후 디자인 생성/수정에 계속 반영)
        Map<String, SlotData> slots = loadSlots(session.getExtractedPreferences());
        applySlotActions(slots, resultJson.path("slotActions"));
        if (newShape != null) {
            // 쉐입은 하나만 고를 수 있으므로 마지막으로 정한 쉐입으로 교체한다.
            // (결과 화면 키워드에 처음 골랐던 쉐입이 남지 않도록 GPT의 slotActions에만 맡기지 않는다)
            SlotData shapeSlot = slots.computeIfAbsent("shape", k -> new SlotData());
            shapeSlot.getLiked().clear();
            shapeSlot.getLiked().add(newShape);
            shapeSlot.getDisliked().remove(newShape);
        }
        try {
            session.updateExtractedPreferences(objectMapper.writeValueAsString(slots));
        } catch (Exception ignored) {}
        mergeFingerOverrides(resultJson.path("fingerOverrides"),
                session.getFingerOverrides(), session::updateFingerOverrides);
        mergeFingerDislikes(resultJson.path("fingerDislikes"),
                session.getFingerDislikes(), session::updateFingerDislikes);
        designSessionRepository.save(session);

        // 이번 수정으로 추가/제거된 키워드를 plan.keywordOverrides에 누적 (이후 수정에서도 이어서 반영)
        String nextPlanJson = buildNextPlan(prevDesign.getDesignPlan(), newShape,
                resultJson.path("keywordsAdd"), resultJson.path("keywordsRemove"));
        // 결과 화면 키워드 중 사전에 없는 말의 한글 번역(GPT)을 이미지를 고치는 동안 끝내 둔다
        nailDesignService.prefetchDesignKeywordTranslations(slots, session, nextPlanJson);

        // 3. gpt-image edit 호출 — 마스크 없이 원본 전체 + 지시문만 보냄.
        //    생성과 똑같이 투명 배경으로 받아서(설정이 켜져 있을 때) AR 크롭을 투명 원본의 알파로 만든다. 입력은 흰 배경
        //    합성본이라 모델이 흰 배경을 그대로 그려 불투명으로 줄 수도 있는데, 그러면 아래 크롭 단계가 서버 누끼로 처리한다.
        boolean transparentEdit = nailDesignService.isTransparentGptImage();
        // 캐릭터 추가처럼 참고 사진이 필요한 수정이면 원본 참고 사진도 편집 모델에 함께 보낸다 (두 번째 이미지).
        boolean useReferenceImage = resultJson.path("useReferenceImage").asBoolean(false) && referenceBytes != null;
        List<byte[]> editReferences = useReferenceImage ? List.of(referenceBytes) : List.of();
        System.out.println("[RefineService] useReferenceImage=" + useReferenceImage);
        String editedBase64;
        try {
            String instructionToSend = transparentEdit ? editInstruction + TRANSPARENT_EDIT_SUFFIX : editInstruction;
            editedBase64 = gptClientService.editImage(instructionToSend, originalImageBytes, editReferences, "1536x1024", "auto", transparentEdit);
        } catch (Exception e) {
            if (!transparentEdit) throw e;
            // 스레드가 중단된 경우(서버 재시작/종료, 요청 취소)는 투명 배경 거절이 아니므로 재시도하지 않는다 -
            // 중단 플래그가 켜진 채로 다시 호출해도 곧바로 같은 예외가 나고 GPT 호출만 낭비된다.
            if (Thread.currentThread().isInterrupted() || e instanceof InterruptedException
                    || e.getCause() instanceof InterruptedException
                    || String.valueOf(e.getMessage()).contains("InterruptedException")) throw e;
            // 이미지 수정 API가 투명 배경 요청을 거절하면 수정 기능 전체가 막히므로, 예전 방식(흰 배경)으로 한 번 더 시도한다.
            System.err.println("[RefineService] 투명 배경 수정 요청이 실패해 흰 배경 방식으로 다시 시도합니다: " + e.getMessage());
            transparentEdit = false;
            editedBase64 = gptClientService.editImage(editInstruction, originalImageBytes, editReferences, "1536x1024", "auto", false);
        }

        // 4. 수정된 이미지 S3 업로드 (표시용은 흰 배경을 입힌 것, 투명 원본은 AR 크롭에만 쓴다)
        byte[] editedBytes = Base64.getDecoder().decode(editedBase64);
        String displayBase64 = editedBase64;
        if (transparentEdit) {
            System.out.println("[GptImage] (edit) background=transparent 요청 → 응답: " + PngBackground.describeAlpha(editedBytes));
            editedBytes = PngBackground.compositeOnWhite(editedBytes);
            displayBase64 = Base64.getEncoder().encodeToString(editedBytes);
        }
        String s3Key = "designs/user_" + user.getId() + "/edit_" + UUID.randomUUID() + ".png";
        String newImageUrl = s3Service.uploadImageBytes(editedBytes, s3Key);

        // AR 미리보기용 손톱별 크롭: 생성본과 똑같이 만든다. 없으면 AR이 프론트의 색 기반 누끼로 폴백해서
        // 흰색으로 번지는 손톱 끝이 잘린다.
        String nailTipCropsJson = nailDesignService.createNailTipCrops(user.getId(), editedBase64, displayBase64);

        // 5. 새 NailDesign 저장 (플랜은 그대로 유지, 수정 지시문을 프롬프트로 기록)
        NailDesign newDesign = NailDesign.builder()
                .user(user)
                .session(session)
                .imageUrls(new ArrayList<>(List.of(newImageUrl)))
                .promptSummary(editInstruction)
                .aiModel("gpt-image-2.5-sunburst (edit)")
                .status(NailDesign.DesignStatus.DRAFT)
                // 플랜은 그대로 유지하되, 쉐입이 바뀐 경우 plan의 shape만 새 값으로 바꾼다
                // (AR/3D 템플릿과 이후 수정 요청이 이 shape를 읽는다)
                .designPlan(nextPlanJson)
                .nailTipCropsJson(nailTipCropsJson)
                .seed(null) // OpenAI 이미지 API는 seed 개념이 없어 재현 불가
                .build();
        nailDesignRepository.save(newDesign);
        session.updateGeneratedPrompt(originalPrompt); // 원본 프롬프트 유지
        designSessionRepository.save(session);

        // 6. 채팅 이력 저장
        chatMessageRepository.save(ChatMessage.builder()
                .session(session).role(ChatMessage.MessageRole.assistant)
                .content("말씀하신 대로 수정했어요! 어떠세요?").build());

        return DesignGenerateResponseDto.builder()
                .designId(newDesign.getId())
                .status(newDesign.getStatus().name())
                .generatedPrompt(editInstruction)
                .imageUrls(newDesign.getImageUrls())
                .details(nailDesignService.buildDetails(newDesign))
                .keywords(nailDesignService.extractDesignKeywords(slots, session, nextPlanJson))
                .keywordColors(nailDesignService.extractKeywordColors(slots))
                .slotKeywords(nailDesignService.extractSlotKeywords(slots, session))
                .build();
    }

    /**
     * 프롬프트의 [Conversation so far] 에 넣을 텍스트:
     *  1) 최근 대화(사용자 요청/챗봇 답변, 현재 메시지 제외) 8개
     *  2) 이 세션에서 지금까지 이미지 모델에 보낸 수정 지시문(프롬프트) 최근 5개 - 현재 이미지는 이 수정들이 모두 반영된 결과
     * 둘 다 없으면 "(no earlier turns)".
     */
    private String buildConversationContext(DesignSession session, String currentMessage,
                                            List<NailDesign> designsInSession, NailDesign prevDesign) {
        StringBuilder sb = new StringBuilder();

        List<ChatMessage> all = chatMessageRepository.findBySessionOrderBySentAtAsc(session);
        int end = all.size();
        // 맨 끝은 방금 저장한 현재 사용자 메시지이므로 제외
        if (end > 0 && all.get(end - 1).getRole() == ChatMessage.MessageRole.user
                && currentMessage.equals(all.get(end - 1).getContent())) {
            end--;
        }
        int start = Math.max(0, end - 8);
        for (int i = start; i < end; i++) {
            ChatMessage m = all.get(i);
            String c = m.getContent() == null ? "" : m.getContent().replace("\n", " ").trim();
            if (c.isEmpty()) continue;
            if (c.length() > 160) c = c.substring(0, 160) + "...";
            sb.append(m.getRole() == ChatMessage.MessageRole.user ? "user: " : "assistant: ").append(c).append("\n");
        }

        // 지금까지의 수정 지시문(오래된 것 -> 최근 순). prevDesign(현재 이미지)까지만 포함
        List<String> editInstructions = new ArrayList<>();
        for (NailDesign d : designsInSession) {
            if (d.getAiModel() != null && d.getAiModel().contains("(edit)")
                    && d.getPromptSummary() != null && !d.getPromptSummary().isBlank()) {
                editInstructions.add(d.getPromptSummary().trim());
            }
            if (d.getId().equals(prevDesign.getId())) break;
        }
        if (!editInstructions.isEmpty()) {
            int from = Math.max(0, editInstructions.size() - 5);
            sb.append("[Edit instructions already applied to the image, oldest first - the CURRENT image shows the result of all of them]\n");
            for (int i = from; i < editInstructions.size(); i++) {
                String ins = editInstructions.get(i);
                if (ins.length() > 400) ins = ins.substring(0, 400) + "...";
                sb.append(i + 1).append(") ").append(ins).append("\n");
            }
        }
        return sb.length() == 0 ? "(no earlier turns)" : sb.toString().trim();
    }

    /**
     * 직전 designPlan에 (1) 쉐입 변경과 (2) 키워드 추가/제거(keywordOverrides)를 반영한 새 JSON 문자열.
     * 플랜이 없거나 파싱에 실패하면 쉐입만 처리한 값(또는 원본)을 돌려준다.
     */
    private String buildNextPlan(String prevPlanJson, String newShape, JsonNode addNode, JsonNode removeNode) {
        String base = newShape != null ? withShape(prevPlanJson, newShape) : prevPlanJson;
        if (base == null || base.isBlank()) return base;
        try {
            JsonNode node = objectMapper.readTree(base);
            if (!(node instanceof ObjectNode plan)) return base;

            ObjectNode overrides = plan.path("keywordOverrides") instanceof ObjectNode o
                    ? o : plan.putObject("keywordOverrides");
            List<String> adds = new ArrayList<>();
            List<String> removes = new ArrayList<>();
            overrides.path("add").forEach(n -> adds.add(n.asText("")));
            overrides.path("remove").forEach(n -> removes.add(n.asText("")));

            for (JsonNode n : removeNode) {
                String term = n.asText("").trim();
                if (term.isBlank()) continue;
                adds.removeIf(a -> a.equalsIgnoreCase(term) || a.toLowerCase().contains(term.toLowerCase()));
                if (removes.stream().noneMatch(r -> r.equalsIgnoreCase(term))) removes.add(term);
            }
            for (JsonNode n : addNode) {
                String term = n.asText("").trim();
                if (term.isBlank()) continue;
                removes.removeIf(r -> r.equalsIgnoreCase(term)); // 다시 추가한 것은 제거 목록에서 뺀다
                if (adds.stream().noneMatch(a -> a.equalsIgnoreCase(term))) adds.add(term);
            }

            overrides.putArray("add").addAll(adds.stream()
                    .map(a -> (JsonNode) objectMapper.getNodeFactory().textNode(a)).toList());
            overrides.putArray("remove").addAll(removes.stream()
                    .map(r -> (JsonNode) objectMapper.getNodeFactory().textNode(r)).toList());
            return plan.toString();
        } catch (Exception e) {
            return base;
        }
    }

    /**
     * 이미지를 바꾸지 않고 사용자에게 안내 메시지만 돌려준다. 기존 디자인(이미지)은 그대로 응답에 담고,
     * assistantMessage가 있으면 프론트는 새 이미지 대신 이 메시지를 채팅에 보여준다.
     */
    private DesignGenerateResponseDto replyWithoutEdit(DesignSession session, NailDesign prevDesign, String reply,
                                                       List<String> options) {
        chatMessageRepository.save(ChatMessage.builder()
                .session(session).role(ChatMessage.MessageRole.assistant).content(reply).build());
        return DesignGenerateResponseDto.builder()
                .designId(prevDesign.getId())
                .status(prevDesign.getStatus().name())
                .generatedPrompt(prevDesign.getPromptSummary())
                .imageUrls(prevDesign.getImageUrls())
                .assistantMessage(reply)
                .assistantOptions(options)
                .build();
    }

    private static final List<String> DEFAULT_REPLY_OPTIONS = List.of(
            "전체적으로 색을 더 연하게", "전체적으로 색을 더 진하게", "글리터 추가해줘", "하트 장식 빼줘");

    /** GPT가 준 replyOptions를 정리(공백 제거, 최대 4개, 40자 이내). 비어 있으면 기본 선택지. */
    private List<String> parseReplyOptions(JsonNode node) {
        List<String> out = new ArrayList<>();
        if (node != null && node.isArray()) {
            for (JsonNode n : node) {
                String s = n.asText("").trim();
                if (!s.isEmpty() && s.length() <= 40 && !out.contains(s)) out.add(s);
                if (out.size() >= 4) break;
            }
        }
        return out.isEmpty() ? DEFAULT_REPLY_OPTIONS : out;
    }

    private static final Set<String> KNOWN_SHAPES =
            Set.of("round", "oval", "almond", "square", "stiletto", "ballerina");

    /** GPT가 준 newShape를 앱에서 쓰는 쉐입 키워드로 정리한다. 쉐입 변경이 아니거나 모르는 값이면 null. */
    private String normalizeShape(String raw) {
        if (raw == null) return null;
        String shape = raw.trim().toLowerCase();
        if ("coffin".equals(shape)) shape = "ballerina"; // 앱 내부에서는 항상 ballerina로 통일
        return KNOWN_SHAPES.contains(shape) ? shape : null;
    }

    /** designPlan(JSON 문자열)의 shape만 바꾼 새 JSON 문자열. 파싱에 실패하면 원본을 그대로 돌려준다. */
    private String withShape(String planJson, String shape) {
        if (planJson == null || planJson.isBlank()) return planJson;
        try {
            JsonNode node = objectMapper.readTree(planJson);
            if (node instanceof ObjectNode obj) {
                obj.put("shape", shape);
                return obj.toString();
            }
        } catch (Exception ignored) {}
        return planJson;
    }

    // -------------------------------------------------------------------------
    // 슬롯 업데이트 (기존 로직 유지)
    // -------------------------------------------------------------------------
    private Map<String, SlotData> loadSlots(String json) {
        if (json == null || json.isBlank()) return new HashMap<>();
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructMapType(HashMap.class, String.class, SlotData.class));
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

    private void applySlotActions(Map<String, SlotData> slots, JsonNode slotActionsNode) {
        if (slotActionsNode == null || !slotActionsNode.isArray()) return;
        for (JsonNode action : slotActionsNode) {
            String category   = action.path("category").asText("");
            String actionType = action.path("action").asText("");
            String value      = action.path("value").asText("");
            if (category.isBlank() || actionType.isBlank() || value.isBlank()) continue;
            if ("color".equals(category) && !HEX_PATTERN.matcher(value.trim()).matches()) continue;

            SlotData slot = slots.computeIfAbsent(category, k -> new SlotData());
            if ("add_like".equals(actionType)) {
                // 해당 카테고리 전체를 이 값 하나로 교체 (쉐입/계절처럼 하나만 고르는 항목용)
                slot.getLiked().clear();
                slot.getLiked().add(value);
                slot.getDisliked().remove(value);
            } else if ("append_like".equals(actionType)) {
                // 기존 값은 두고 추가 (모티프/무드/컬러처럼 여러 개를 고르는 항목용).
                // "없음/상관없음"이 들어 있었다면 실제 값이 생겼으니 뺀다.
                slot.getLiked().removeIf(v -> v == null || v.isBlank()
                        || "none".equalsIgnoreCase(v.trim()) || "상관없음".equals(v.trim()) || "없음".equals(v.trim()));
                if (!slot.getLiked().contains(value)) slot.getLiked().add(value);
                slot.getDisliked().remove(value);
            } else if ("remove_like".equals(actionType)) {
                slot.getLiked().remove(value);
            } else if ("add_dislike".equals(actionType)) {
                if (!slot.getDisliked().contains(value)) slot.getDisliked().add(value);
                slot.getLiked().remove(value);
            }
        }
    }

    private void mergeFingerOverrides(JsonNode newNode, String existingJson,
                                      java.util.function.Consumer<String> updater) {
        if (newNode == null || !newNode.isObject() || newNode.isEmpty()) return;
        Map<String, String> merged = new HashMap<>();
        if (existingJson != null && !existingJson.isBlank()) {
            try {
                objectMapper.readTree(existingJson).fields()
                        .forEachRemaining(e -> merged.put(e.getKey(), e.getValue().asText()));
            } catch (Exception ignored) {}
        }
        newNode.fields().forEachRemaining(e -> merged.put(e.getKey(), e.getValue().asText()));
        try { updater.accept(objectMapper.writeValueAsString(merged)); } catch (Exception ignored) {}
    }

    private void mergeFingerDislikes(JsonNode newNode, String existingJson,
                                     java.util.function.Consumer<String> updater) {
        if (newNode == null || !newNode.isObject() || newNode.isEmpty()) return;
        Map<String, List<String>> merged = new HashMap<>();
        if (existingJson != null && !existingJson.isBlank()) {
            try {
                objectMapper.readTree(existingJson).fields().forEachRemaining(e -> {
                    List<String> items = new ArrayList<>();
                    e.getValue().forEach(v -> items.add(v.asText()));
                    merged.put(e.getKey(), items);
                });
            } catch (Exception ignored) {}
        }
        newNode.fields().forEachRemaining(e -> {
            List<String> items = merged.computeIfAbsent(e.getKey(), k -> new ArrayList<>());
            e.getValue().forEach(v -> { if (!items.contains(v.asText())) items.add(v.asText()); });
        });
        try { updater.accept(objectMapper.writeValueAsString(merged)); } catch (Exception ignored) {}
    }
}
