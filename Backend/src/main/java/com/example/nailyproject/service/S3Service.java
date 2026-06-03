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

//이미지 올리기 + 이미지 삭제
@Service
@RequiredArgsConstructor
public class S3Service {

    private final AmazonS3 amazonS3;

    @Value("${cloud.aws.s3.bucket}")
    private String bucket;

    /**
     * 이미지 업로드
     * 경로: {userId}/{handSide}/{finger}/image_{uuid}.jpg
     */
    public String uploadImage(MultipartFile file, Long userId, String handSide, String finger) throws IOException {
        String path = buildImagePath(userId, handSide, finger);
        return upload(file.getInputStream(), path, file.getContentType(), file.getSize());
    }

    /**
     * STL 파일 업로드
     * 경로: {userId}/{handSide}/{finger}/stl/{fileName}
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

    /**
     * 이미지 경로 생성
     * {userId}/{handSide}/{finger}/image.jpg
     */
    private String buildImagePath(Long userId, String handSide, String finger) {
        return userId + "/" + handSide.toLowerCase() + "/" + finger.toLowerCase() + "/image.jpg";
    }
}