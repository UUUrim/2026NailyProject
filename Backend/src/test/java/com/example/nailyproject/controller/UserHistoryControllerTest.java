package com.example.nailyproject.controller;

import com.example.nailyproject.dto.response.ScanSessionDto;
import com.example.nailyproject.entity.HandScan;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.HandScanRepository;
import com.example.nailyproject.service.PrintOrderService;
import com.example.nailyproject.service.ScanResultFileService;
import com.example.nailyproject.service.ScanService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 손 분석 기록(GET /users/me/scan-sessions)에는 분석 결과 화면에서 확정된 스캔만 나오는지 확인한다.
 */
class UserHistoryControllerTest {

    private static final long USER = 7L;

    @TempDir
    Path results;

    private HandScanRepository handScanRepository;
    private UserHistoryController controller;
    private final User user = User.builder().id(USER).build();

    @BeforeEach
    void setUp() throws IOException {
        handScanRepository = mock(HandScanRepository.class);
        when(handScanRepository.findByIdAndUserId(any(), any())).thenReturn(Optional.empty());
        // 채팅/디자인에 쓰인 기록이 없는 사용자 (삭제 가능 여부 판단용)
        ScanService scanService = mock(ScanService.class);
        when(scanService.scanUsage(any())).thenReturn(new ScanService.ScanUsage(Set.of(), Set.of()));
        controller = new UserHistoryController(
                handScanRepository, mock(PrintOrderService.class), new ScanResultFileService(results.toString()), scanService);

        Path dir = results.resolve(String.valueOf(USER)).resolve("10_11").resolve("both");
        Files.createDirectories(dir);
        try (InputStream in = getClass().getResourceAsStream("/scan/final_measurements_sample.json")) {
            Files.writeString(dir.resolve("measurements.json"), new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    private void handRows(Boolean leftConfirmed, Boolean rightConfirmed) {
        HandScan left = HandScan.builder().id(10L).user(user).handSide(HandScan.HandSide.LEFT)
                .status(HandScan.ScanStatus.MEASURED).pairedScanId(11L).resultConfirmed(leftConfirmed).build();
        HandScan right = HandScan.builder().id(11L).user(user).handSide(HandScan.HandSide.RIGHT)
                .status(HandScan.ScanStatus.MEASURED).pairedScanId(10L).resultConfirmed(rightConfirmed).build();
        when(handScanRepository.findByIdAndUserId(10L, USER)).thenReturn(Optional.of(left));
        when(handScanRepository.findByIdAndUserId(11L, USER)).thenReturn(Optional.of(right));
    }

    private List<ScanSessionDto> sessions() {
        return controller.getMyScanSessions(user).getBody().getData();
    }

    @Test
    void 결과_화면에서_확정되기_전엔_파일이_있어도_기록에_안_나온다() {
        handRows(false, false);
        assertTrue(sessions().isEmpty());
    }

    @Test
    void 확정된_스캔은_기록에_나온다() {
        handRows(true, true);
        List<ScanSessionDto> data = sessions();
        assertEquals(1, data.size());
        assertEquals("10-11", data.get(0).getKey());
    }

    @Test
    void 확정_컬럼이_없던_예전_스캔은_그대로_나온다() {
        handRows(null, null);
        assertEquals(1, sessions().size());
    }

    @Test
    void DB_행이_없는_예전_파일도_그대로_나온다() {
        assertEquals(1, sessions().size());
    }
}
