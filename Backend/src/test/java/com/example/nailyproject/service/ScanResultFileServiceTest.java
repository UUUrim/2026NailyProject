package com.example.nailyproject.service;

import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.service.ScanResultFileService.ScanAnalysis;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * scan/final_measurements.py가 실제로 만든 최종 measurements.json(테스트 리소스)을 읽어서
 * 화면/디자인 생성이 쓰는 값으로 바르게 변환되는지 확인한다.
 */
class ScanResultFileServiceTest {

    private static final long USER = 7L;
    private final ObjectMapper mapper = new ObjectMapper();

    @TempDir
    Path results;

    private ScanResultFileService service;
    private String sampleJson;

    @BeforeEach
    void setUp() throws IOException {
        service = new ScanResultFileService(results.toString());
        try (InputStream in = getClass().getResourceAsStream("/scan/final_measurements_sample.json")) {
            assertNotNull(in, "테스트 리소스가 없음");
            sampleJson = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    private Path putFinal(String pair, String json, long modifiedMillis) throws IOException {
        Path dir = results.resolve(String.valueOf(USER)).resolve(pair).resolve("both");
        Files.createDirectories(dir);
        Path file = dir.resolve("measurements.json");
        Files.writeString(file, json);
        Files.setLastModifiedTime(file, FileTime.fromMillis(modifiedMillis));
        return file;
    }

    @Test
    void 왼손_scanId로_조회하면_양손_기준_분석값과_왼손_손가락이_나온다() throws IOException {
        putFinal("10_11", sampleJson, 1_000_000L);

        ScanAnalysis a = service.analysis(USER, 10).orElseThrow();

        assertEquals(30, a.recommendedColors().size());
        assertTrue(a.recommendedColors().stream().allMatch(c -> c.matches("^#[0-9A-Fa-f]{6}$")));
        assertNotNull(a.skinToneHex());
        assertTrue(List.of("warm", "cool", "neutral").contains(a.tone()));
        assertNotNull(a.warmness());
        assertNotNull(a.brightness());
        assertNotNull(a.saturation());
        assertNotNull(a.recommendedShape());
        assertNotNull(a.overallSize());
        assertNotNull(a.avgLengthMm());
        assertNotNull(a.avgWidthMm());
        assertNotNull(a.avgCurveMm());
        assertEquals(5, a.fingers().size());
        assertEquals("THUMB", a.fingers().get(0).finger());
    }

    @Test
    void 손가락_measurements는_프론트가_JSON_parse하는_camelCase_문자열이다() throws Exception {
        putFinal("10_11", sampleJson, 1_000_000L);

        ScanAnalysis a = service.analysis(USER, 10).orElseThrow();
        JsonNode m = mapper.readTree(a.fingers().get(0).measurementsJson());

        assertTrue(m.path("lengthMm").isNumber());
        assertTrue(m.path("widthMm").isNumber());
        assertTrue(m.path("cCurveMm").isNumber());
    }

    @Test
    void 오른손_scanId로_조회하면_오른손_블록의_손가락이_나온다() throws Exception {
        putFinal("10_11", sampleJson, 1_000_000L);

        ScanAnalysis left = service.analysis(USER, 10).orElseThrow();
        ScanAnalysis right = service.analysis(USER, 11).orElseThrow();

        // 컬러/피부/쉐입은 양손 공통, 손가락과 평균 치수는 손마다 다르다
        assertEquals(left.recommendedColors(), right.recommendedColors());
        assertEquals(left.skinToneHex(), right.skinToneHex());
        assertNotEquals(left.fingers().get(0).measurementsJson(), right.fingers().get(0).measurementsJson());
        JsonNode expectedRight = mapper.readTree(sampleJson).path("right").path("fingers").get(0).path("measurements");
        assertEquals(expectedRight, mapper.readTree(right.fingers().get(0).measurementsJson()));
    }

    @Test
    void 손톱이_손가락_끝보다_나온_평균_길이는_손별_요약에서_읽는다() throws Exception {
        JsonNode root = mapper.readTree(sampleJson);
        ((com.fasterxml.jackson.databind.node.ObjectNode) root.path("left").path("summary")).put("avg_free_edge_mm", 2.6);
        ((com.fasterxml.jackson.databind.node.ObjectNode) root.path("right").path("summary")).put("avg_free_edge_mm", 0.0);
        putFinal("10_11", mapper.writeValueAsString(root), 1_000_000L);

        assertEquals(2.6, service.analysis(USER, 10).orElseThrow().avgFreeEdgeMm());
        assertEquals(0.0, service.analysis(USER, 11).orElseThrow().avgFreeEdgeMm());
    }

    @Test
    void 손톱_끝_값이_없던_예전_파일이면_null이다() throws IOException {
        putFinal("10_11", sampleJson, 1_000_000L);   // 샘플은 free edge 측정 전에 만들어진 파일
        assertNull(service.analysis(USER, 10).orElseThrow().avgFreeEdgeMm());
    }

    @Test
    void 파일이_없으면_빈_Optional이다() {
        assertTrue(service.analysis(USER, 10).isEmpty());          // 사용자 폴더 자체가 없음
        assertTrue(service.analysis(999, 10).isEmpty());
    }

    @Test
    void 다른_scanId는_찾지_않는다_그리고_숫자_쌍이_아닌_폴더는_무시한다() throws IOException {
        putFinal("10_11", sampleJson, 1_000_000L);
        putFinal("abc_def", sampleJson, 2_000_000L);
        putFinal("10", sampleJson, 2_000_000L);

        assertTrue(service.analysis(USER, 12).isEmpty());
        assertTrue(service.analysis(USER, 1).isEmpty());   // "10_11"의 부분 문자열이 아니라 정확히 일치해야 함
    }

    @Test
    void 같은_scanId가_여러_쌍에_있으면_가장_최근에_만들어진_파일을_쓴다() throws Exception {
        // 낡은 짝(12_10)이 새 짝(12_13)보다 먼저 만들어진 경우 - 12번은 새 짝 값을 써야 한다
        JsonNode stale = mapper.readTree(sampleJson);
        ((com.fasterxml.jackson.databind.node.ObjectNode) stale).put("recommendedShape", "stiletto");
        JsonNode fresh = mapper.readTree(sampleJson);
        ((com.fasterxml.jackson.databind.node.ObjectNode) fresh).put("recommendedShape", "oval");
        putFinal("12_10", mapper.writeValueAsString(stale), 1_000_000L);
        putFinal("12_13", mapper.writeValueAsString(fresh), 2_000_000L);

        assertEquals("oval", service.analysis(USER, 12).orElseThrow().recommendedShape());
    }

    @Test
    void 파일이_갱신되면_캐시가_아니라_새_내용을_읽는다() throws Exception {
        Path file = putFinal("10_11", sampleJson, 1_000_000L);
        assertNotEquals("round_x", service.analysis(USER, 10).orElseThrow().recommendedShape());

        JsonNode updated = mapper.readTree(sampleJson);
        ((com.fasterxml.jackson.databind.node.ObjectNode) updated).put("recommendedShape", "round_x");
        Files.writeString(file, mapper.writeValueAsString(updated));
        Files.setLastModifiedTime(file, FileTime.fromMillis(5_000_000L));

        assertEquals("round_x", service.analysis(USER, 10).orElseThrow().recommendedShape());
    }

    @Test
    void 깨진_파일은_빈_Optional이라_DB_값으로_대체된다() throws IOException {
        putFinal("10_11", "{ 깨진 json", 1_000_000L);
        assertTrue(service.analysis(USER, 10).isEmpty());
    }

    @Test
    void HandScan_기준_조회_파일이_있으면_파일_값을_쓴다() throws IOException {
        putFinal("10_11", sampleJson, 1_000_000L);
        HandScan scan = HandScan.builder()
                .id(10L)
                .user(User.builder().id(USER).build())
                .build();

        assertEquals(30, service.recommendedColors(scan).size());
        assertNotNull(service.recommendedShape(scan));
    }

    @Test
    void 파일이_없으면_DB로_대체하지_않고_빈_값이다() {
        HandScan scan = HandScan.builder()
                .id(55L)
                .user(User.builder().id(USER).build())
                .build();

        assertEquals(List.of(), service.recommendedColors(scan));
        assertNull(service.recommendedShape(scan));
        assertTrue(service.analysisFor(scan).isEmpty());
    }

    @Test
    void 사용자_정보가_없거나_null이어도_예외없이_빈_값이다() {
        HandScan noUser = HandScan.builder().id(55L).build();
        assertEquals(List.of(), service.recommendedColors(noUser));
        assertEquals(List.of(), service.recommendedColors(null));
        assertNull(service.recommendedShape(null));
        Optional<ScanAnalysis> none = service.analysisFor(noUser);
        assertTrue(none.isEmpty());
    }
}
