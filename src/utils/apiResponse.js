// src/utils/apiResponse.js
/**
 * API 응답 표준화를 위한 유틸리티
 */
exports.success = (res, data, message = "성공", source = "live") => {
    return res.json({
        success: true,
        message: message,
        source: source, // 데이터 출처 (live/cache) 확인용
        data: data
    });
};

exports.error = (res, errorMessage, statusCode = 500) => {
    return res.status(statusCode).json({
        success: false,
        message: errorMessage
    });
};