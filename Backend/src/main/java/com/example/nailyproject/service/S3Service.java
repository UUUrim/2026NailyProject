package com.example.nailyproject.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.ObjectMetadata;
import com.amazonaws.services.s3.model.PutObjectRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;

//이미지 올리기 + 이미지 삭제
@Service
@RequiredArgsConstructor
public class S3Service {

    private final AmazonS3 amazonS3;

    @Value("${cloud.aws.s3.bucket}")
    private String bucket;

    /**
     * [수정됨] 이미지 업로드 (경로를 외부에서 주입받음)
     * ScanService에서 만든 s3Key (예: photos/u001/125/right/thumb.jpg) 그대로 업로드합니다.
     */
    public String uploadImageWithKey(MultipartFile file, String s3Key) throws IOException {
        return upload(file.getInputStream(), s3Key, file.getContentType(), file.getSize());
    }

    /**
     * STL 파일 업로드 (이 부분도 나중에 파이썬이 올릴 거면 안 쓰일 수 있지만, 일단 둠 )
     */
    public String uploadStl(InputStream inputStream, Long userId, String handSide, String finger, String fileName, long size) throws IOException {
        String path = userId + "/" + handSide.toLowerCase() + "/" + finger.toLowerCase() + "/stl/" + fileName;
        return upload(inputStream, path, "application/octet-stream", size);
    }


    /**
     * S3 업로드 공통 메서드
     */
    private String upload(InputStream inputStream, String path, String contentType, long size) {
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(contentType);
        metadata.setContentLength(size);

        amazonS3.putObject(new PutObjectRequest(bucket, path, inputStream, metadata));
        return amazonS3.getUrl(bucket, path).toString();
    }

    /**
     * S3 파일 삭제
     */
    public void deleteFile(String fileUrl) {
        String fileName = fileUrl.substring(fileUrl.indexOf(bucket) + bucket.length() + 1);
        amazonS3.deleteObject(bucket, fileName);
    }

//    /**
//     * 이미지 경로 생성
//     * {userId}/{handSide}/{finger}/image.jpg
//     */
//    private String buildImagePath(Long userId, String handSide, String finger) {
//        return userId + "/" + handSide.toLowerCase() + "/" + finger.toLowerCase() + "/image.jpg";
//    }
    /**
     * 백엔드가 다운로드한 이미지(Byte 배열)를 S3에 직접 업로드
     */
    public String uploadImageBytes(byte[] imageBytes, String s3Key) {
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType("image/png"); // ComfyUI는 기본적으로 png를 뱉어냅니다
        metadata.setContentLength(imageBytes.length);

        try (InputStream inputStream = new ByteArrayInputStream(imageBytes)) {
            amazonS3.putObject(new PutObjectRequest(bucket, s3Key, inputStream, metadata));
            return amazonS3.getUrl(bucket, s3Key).toString(); // S3 영구 주소 반환
        } catch (Exception e) {
            throw new RuntimeException("S3 이미지 업로드 중 오류 발생", e);
        }
    }
}