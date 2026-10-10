package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.ScanResultRequestDto;
import com.example.nailyproject.dto.request.ScanStartRequestDto;
import com.example.nailyproject.dto.response.ScanResultResponseDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 스캔 서버의 상태 콜백 처리와, 로컬 최종 measurements.json이 조회 응답에 채워지는지 확인한다.
 */
class ScanServiceTest {

    private static final long USER = 7L;
    private final ObjectMapper mapper = new ObjectMapper();

    @TempDir
    Path results;

    private HandScanRepository handScanRepository;
    private ScanService service;
    private HandScan left;

    @BeforeEach
    void setUp() {
        handScanRepository = mock(HandScanRepository.class);
        service = new ScanService(
                handScanRepository,
                mock(WebClient.Builder.class),
                mock(PrintOrderService.class),
                new ScanResultFileService(results.toString()));

        left = HandScan.builder()
                .id(10L)
                .user(User.builder().id(USER).build())
                .handSide(HandScan.HandSide.LEFT)
                .status(HandScan.ScanStatus.ANALYZING)
                .build();
        when(handScanRepository.findById(10L)).thenReturn(Optional.of(left));
        when(handScanRepository.findByIdAndUserId(10L, USER)).thenReturn(Optional.of(left));
    }

    private ScanResultRequestDto callback(String json) throws IOException {
        return mapper.readValue(json, ScanResultRequestDto.class);
    }

    private void putFinalFile() throws IOException {
        Path dir = results.resolve(String.valueOf(USER)).resolve("10_11").resolve("both");
        Files.createDirectories(dir);
        try (InputStream in = getClass().getResourceAsStream("/scan/final_measurements_sample.json")) {
            Files.writeString(dir.resolve("measurements.json"), new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    // ── 스캔 시작: 같은 스캔의 반대 손을 짝으로 기록 ─────────────────────

    private ScanStartRequestDto startRequest(String json) throws IOException {
        return mapper.readValue(json, ScanStartRequestDto.class);
    }

    private void saveAs(long id) {
        when(handScanRepository.save(any())).thenAnswer(inv -> {
            HandScan s = inv.getArgument(0);
            return HandScan.builder().id(id).user(s.getUser()).handSide(s.getHandSide())
                    .status(s.getStatus()).pairedScanId(s.getPairedScanId()).build();
        });
    }

    @Test
    void 짝_없이_시작하면_짝이_없다() throws IOException {
        saveAs(11L);
        service.startScan(left.getUser(), startRequest("{\"handSide\":\"LEFT\"}"));
        assertNull(left.getPairedScanId());
    }

    @Test
    void 반대_손을_짝으로_시작하면_서로를_가리킨다() throws IOException {
        saveAs(11L);
        service.startScan(left.getUser(), startRequest("{\"handSide\":\"RIGHT\",\"pairedScanId\":10}"));
        assertEquals(11L, left.getPairedScanId());
    }

    @Test
    void 같은_손끼리는_짝이_될_수_없다() throws IOException {
        saveAs(11L);
        assertThrows(IllegalArgumentException.class,
                () -> service.startScan(left.getUser(), startRequest("{\"handSide\":\"LEFT\",\"pairedScanId\":10}")));
        assertNull(left.getPairedScanId());
    }

    @Test
    void 이미_짝이_있는_스캔과는_짝이_될_수_없다() throws IOException {
        left.pairWith(99L);
        saveAs(11L);
        assertThrows(IllegalArgumentException.class,
                () -> service.startScan(left.getUser(), startRequest("{\"handSide\":\"RIGHT\",\"pairedScanId\":10}")));
        assertEquals(99L, left.getPairedScanId());
    }

    @Test
    void 없는_스캔을_짝으로_지정하면_거부된다() throws IOException {
        saveAs(11L);
        assertThrows(IllegalArgumentException.class,
                () -> service.startScan(left.getUser(), startRequest("{\"handSide\":\"RIGHT\",\"pairedScanId\":555}")));
    }

    // ── 상태 콜백 ───────────────────────────────────────────────────────

    @Test
    void 측정_성공_콜백이면_MEASURED가_된다() throws IOException {
        service.receiveAnalyzeResult(10L, callback("{\"success\":true,\"measuredFingers\":5}"));
        assertEquals(HandScan.ScanStatus.MEASURED, left.getStatus());
    }

    @Test
    void 일부_손가락만_성공해도_MEASURED다() throws IOException {
        service.receiveAnalyzeResult(10L, callback("{\"success\":true,\"measuredFingers\":3}"));
        assertEquals(HandScan.ScanStatus.MEASURED, left.getStatus());
    }

    @Test
    void 측정이_하나도_없으면_FAILED다() throws IOException {
        service.receiveAnalyzeResult(10L, callback("{\"success\":false,\"measuredFingers\":0,\"message\":\"x\"}"));
        assertEquals(HandScan.ScanStatus.FAILED, left.getStatus());
    }

    @Test
    void success가_없거나_measuredFingers가_없는_콜백은_FAILED다() throws IOException {
        service.receiveAnalyzeResult(10L, callback("{}"));
        assertEquals(HandScan.ScanStatus.FAILED, left.getStatus());
    }

    @Test
    void 옛_형식_콜백이_와도_예외없이_FAILED로_처리한다() throws IOException {
        // 옛 스캔 서버가 보내던 분석 값 형식 - 모르는 필드는 무시하고 success가 없으니 FAILED
        ObjectMapper lenient = new ObjectMapper().configure(
                com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        ScanResultRequestDto old = lenient.readValue("{\"shape\":\"round\",\"fingers\":[{\"finger\":\"THUMB\"}]}",
                ScanResultRequestDto.class);
        service.receiveAnalyzeResult(10L, old);
        assertEquals(HandScan.ScanStatus.FAILED, left.getStatus());
    }

    // ── 조회 응답 ───────────────────────────────────────────────────────

    @Test
    void 최종_파일이_있으면_분석값이_채워지고_상태는_DB_값이다() throws IOException {
        left.updateStatus(HandScan.ScanStatus.MEASURED);
        putFinalFile();

        ScanResultResponseDto dto = service.getScanResult(User.builder().id(USER).build(), 10L);

        assertEquals("MEASURED", dto.getStatus());
        assertEquals("LEFT", dto.getHandSide());
        assertEquals(30, dto.getRecommendedColors().size());
        assertNotNull(dto.getSkinToneHex());
        assertNotNull(dto.getTone());
        assertNotNull(dto.getRecommendedShape());
        assertEquals(dto.getRecommendedShape(), dto.getShape());
        assertNotNull(dto.getOverallSize());
        assertEquals(5, dto.getFingers().size());
    }

    @Test
    void 최종_파일이_없으면_분석값은_비어있고_상태만_나온다() {
        left.updateStatus(HandScan.ScanStatus.MEASURED);

        ScanResultResponseDto dto = service.getScanResult(User.builder().id(USER).build(), 10L);

        assertEquals("MEASURED", dto.getStatus());
        assertTrue(dto.getRecommendedColors().isEmpty());
        assertTrue(dto.getFingers().isEmpty());
        assertNull(dto.getSkinToneHex());
        assertNull(dto.getRecommendedShape());
    }

    @Test
    void 남의_스캔은_조회할_수_없다() {
        when(handScanRepository.findByIdAndUserId(any(), any())).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class,
                () -> service.getScanResult(User.builder().id(999L).build(), 10L));
    }
}
