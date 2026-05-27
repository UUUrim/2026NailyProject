package com.example.nailyproject.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller
public class MainController {

    @GetMapping("/hello")
    @ResponseBody
    public String hello() {
        return "Hello from Spring Boot!";
    }

    @GetMapping("/")
    public String mainPage() {
        return "main";
    }

    @GetMapping("/login")
    public String loginPage() {
        return "login";
    }

    @GetMapping("/signup")
    public String signupPage() {
        return "signup";
    }

    @GetMapping("/profile")
    public String profileTestPage() {
        return "profile";
    }

    @GetMapping("/chat-test")
    public String chatTestPage() {
        return "ChatTest";
    }
}