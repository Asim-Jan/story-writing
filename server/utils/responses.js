/**
 * Standardized API Response Helpers
 */

export class ApiResponse {
  static success(res, data, message = null, statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      ...(message && { message }),
      ...data,
    });
  }

  static error(res, message, statusCode = 500, details = null) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      ...(details && { details }),
    });
  }

  static created(res, data, message = 'Resource created') {
    return this.success(res, data, message, 201);
  }

  static noContent(res) {
    return res.status(204).send();
  }

  static badRequest(res, message, details = null) {
    return this.error(res, message, 400, details);
  }

  static unauthorized(res, message = 'Authentication required') {
    return this.error(res, message, 401);
  }

  static forbidden(res, message = 'Permission denied') {
    return this.error(res, message, 403);
  }

  static notFound(res, message = 'Resource not found') {
    return this.error(res, message, 404);
  }

  static conflict(res, message, details = null) {
    return this.error(res, message, 409, details);
  }

  static serviceUnavailable(res, message, details = null) {
    return this.error(res, message, 503, details);
  }
}
