package com.example.nailyproject.service;

import com.example.nailyproject.dto.request.PrintOrderRequestDto;
import com.example.nailyproject.dto.response.PrintOrderResponseDto;
import com.example.nailyproject.entity.PrintOrder;
import com.example.nailyproject.entity.User;
import com.example.nailyproject.repository.PrintOrderRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional
public class PrintOrderService {

    private final PrintOrderRepository printOrderRepository;

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy. M. d. HH:mm:ss");

    public PrintOrderResponseDto createPrintOrder(User user, PrintOrderRequestDto request) {
        PrintOrder order = PrintOrder.builder()
                .user(user)
                .shapeId(request.getShapeId())
                .shapeLabelKo(request.getShapeLabelKo())
                .leftScanId(request.getLeftScanId())
                .rightScanId(request.getRightScanId())
                .build();

        PrintOrder saved = printOrderRepository.save(order);
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public List<PrintOrderResponseDto> getMyPrintOrders(User user) {
        return printOrderRepository.findAllByUserOrderByOrderedAtDesc(user).stream()
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    private PrintOrderResponseDto toDto(PrintOrder order) {
        return PrintOrderResponseDto.builder()
                .id(order.getId())
                .shapeId(order.getShapeId())
                .shapeLabelKo(order.getShapeLabelKo())
                .status(order.getStatus().name())
                .orderedAt(order.getOrderedAt() != null ? order.getOrderedAt().format(FORMATTER) : "")
                .leftScanId(order.getLeftScanId())
                .rightScanId(order.getRightScanId())
                .build();
    }
}