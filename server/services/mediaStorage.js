import * as Minio from 'minio';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/**
 * Media Storage Service - Supports both AWS S3 and MinIO
 * Provides centralized, cross-device media storage
 */
/* Object metadata travels as HTTP headers (x-amz-meta-*), which must be ASCII with no newlines.
   Callers pass user prompts and model-written titles, so a newline, an em-dash or an undefined
   value threw ERR_INVALID_CHAR / ERR_HTTP_INVALID_HEADER_VALUE after a paid generation had already
   run. Keep plain keys, drop empties, percent-encode values, cap the length. */
function safeMetadata(metadata = {}) {
  const out = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v === undefined || v === null || typeof v === 'object') continue;
    const key = String(k).replace(/[^A-Za-z0-9-]/g, '');
    if (!key || /^content-type$/i.test(key)) continue;
    out[key] = encodeURIComponent(String(v)).slice(0, 512);
  }
  return out;
}

export class MediaStorage {
  constructor() {
    // Determine storage backend based on environment variables
    this.useS3 = !!process.env.AWS_S3_BUCKET;

    if (this.useS3) {
      // AWS S3 Configuration
      this.s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        } : undefined, // Use IAM role if credentials not provided
      });

      // Single bucket with prefixes for different media types
      this.s3Bucket = process.env.AWS_S3_BUCKET;
      this.buckets = {
        images: 'images',    // These become prefixes in S3
        audio: 'audio',
        comics: 'comics',
        videos: 'videos',
      };
    } else {
      // MinIO Configuration. Production must name its own credentials: the built-in development pair is public knowledge
      // (it is what a stock MinIO ships with), so it is used only when NODE_ENV is not "production".
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd && (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY)) {
        throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set in production (or set AWS_S3_BUCKET to use S3)');
      }
      this.client = new Minio.Client({
        endPoint: process.env.MINIO_ENDPOINT || 'localhost',
        port: parseInt(process.env.MINIO_PORT) || 9000,
        useSSL: process.env.MINIO_USE_SSL === 'true',
        accessKey: process.env.MINIO_ACCESS_KEY || (isProd ? '' : 'minioadmin'),
        secretKey: process.env.MINIO_SECRET_KEY || (isProd ? '' : 'minioadmin123'),
      });

      this.buckets = {
        images: process.env.MINIO_BUCKET_IMAGES || 'book-images',
        audio: process.env.MINIO_BUCKET_AUDIO || 'book-audio',
        comics: process.env.MINIO_BUCKET_COMICS || 'book-comics',
        videos: process.env.MINIO_BUCKET_VIDEOS || 'book-videos',
      };
    }

    this.initialized = false;
  }

  /**
   * Initialize buckets (create if they don't exist)
   */
  async initialize() {
    if (this.initialized) return;

    try {
      if (this.useS3) {
        // For S3, assume bucket already exists and has proper permissions
        // Buckets should be created via Terraform/CloudFormation/AWS Console
        console.log(`✓ Using AWS S3 bucket: ${this.s3Bucket}`);
        this.initialized = true;
      } else {
        // MinIO bucket creation
        for (const [key, bucketName] of Object.entries(this.buckets)) {
          const exists = await this.client.bucketExists(bucketName);
          if (!exists) {
            await this.client.makeBucket(bucketName, 'us-east-1');
            console.log(`✓ Created MinIO bucket: ${bucketName}`);

            // Set public read policy for easier access
            const policy = {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { AWS: ['*'] },
                  Action: ['s3:GetObject'],
                  Resource: [`arn:aws:s3:::${bucketName}/*`],
                },
              ],
            };
            await this.client.setBucketPolicy(bucketName, JSON.stringify(policy));
          } else {
            console.log(`✓ MinIO bucket exists: ${bucketName}`);
          }
        }

        this.initialized = true;
        console.log('✓ MinIO initialized successfully');
      }
    } catch (error) {
      console.error('Storage initialization error:', error);
      throw error;
    }
  }

  /**
   * Upload file buffer to storage (S3 or MinIO)
   * @param {string} bucketType - Bucket type ('images', 'audio', 'comics', 'videos')
   * @param {Buffer} buffer - File buffer
   * @param {string} filename - File name
   * @param {Object} metadata - Optional metadata (should include bookId for access control)
   * @param {Function} setMapping - Optional callback to store media-to-book mapping for access control
   * @returns {Promise<Object>} Upload result with storageKey and url
   */
  async upload(bucketType, buffer, filename, metadata = {}, setMapping = null) {
    await this.initialize();

    const bucket = this.buckets[bucketType];
    if (!bucket) {
      throw new Error(`Invalid bucket type: ${bucketType}`);
    }

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const contentTypeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    try {
      if (this.useS3) {
        // AWS S3 Upload
        const key = `${bucket}/${filename}`; // e.g., "images/myfile.png"
        const command = new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          Metadata: metadata,
        });

        await this.s3Client.send(command);
        const storageKey = `${bucketType}/${filename}`;

        console.log(`✓ Uploaded to S3: ${storageKey}`);

        // SECURITY: Store media-to-book mapping if bookId provided and setMapping callback available
        if (metadata.bookId && setMapping) {
          await setMapping(bucketType, filename, metadata.bookId);
        }

        return {
          storageKey,
          bucket: this.s3Bucket,
          filename,
          size: buffer.length,
          contentType,
        };
      } else {
        // MinIO Upload
        await this.client.putObject(bucket, filename, buffer, buffer.length, {
          ...safeMetadata(metadata),
          'Content-Type': contentType,
        });

        const storageKey = `${bucketType}/${filename}`;

        console.log(`✓ Uploaded to MinIO: ${storageKey}`);

        // SECURITY: Store media-to-book mapping if bookId provided and setMapping callback available
        if (metadata.bookId && setMapping) {
          await setMapping(bucketType, filename, metadata.bookId);
        }

        return {
          storageKey,
          bucket,
          filename,
          size: buffer.length,
          contentType,
        };
      }
    } catch (error) {
      console.error('Storage upload error:', error);
      throw new Error(`Failed to upload to storage: ${error.message}`);
    }
  }

  /**
   * Upload file from filesystem to MinIO
   * @param {string} bucketType - Bucket type
   * @param {string} filePath - Path to file
   * @param {string} filename - Target filename (optional, uses original if not provided)
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(bucketType, filePath, filename = null, metadata = {}) {
    const buffer = fs.readFileSync(filePath);
    const targetFilename = filename || path.basename(filePath);
    return await this.upload(bucketType, buffer, targetFilename, metadata);
  }

  /**
   * Get file stream from storage (S3 or MinIO)
   * @param {string} bucket - Bucket name
   * @param {string} objectName - Object name
   * @returns {Promise<Stream>} File stream
   */
  async getStream(bucket, objectName) {
    await this.initialize();

    if (this.useS3) {
      // AWS S3 Get Stream
      const key = `${bucket}/${objectName}`;
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return response.Body;
    } else {
      // MinIO Get Stream
      return await this.client.getObject(bucket, objectName);
    }
  }

  /**
   * Get file buffer from storage
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @returns {Promise<Buffer>} File buffer
   */
  async getFile(bucketType, filename) {
    await this.initialize();

    const bucket = this.buckets[bucketType];

    if (this.useS3) {
      // AWS S3 Get
      const key = `${bucket}/${filename}`;
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const chunks = [];

      return new Promise((resolve, reject) => {
        response.Body.on('data', (chunk) => chunks.push(chunk));
        response.Body.on('end', () => resolve(Buffer.concat(chunks)));
        response.Body.on('error', reject);
      });
    } else {
      // MinIO Get
      const chunks = [];

      return new Promise((resolve, reject) => {
        this.client.getObject(bucket, filename, (err, stream) => {
          if (err) return reject(err);

          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      });
    }
  }

  /**
   * Delete file from storage
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @returns {Promise<void>}
   */
  async delete(bucketType, filename) {
    await this.initialize();

    const bucket = this.buckets[bucketType];

    if (this.useS3) {
      const key = `${bucket}/${filename}`;
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      console.log(`✓ Deleted from S3: ${bucketType}/${filename}`);
    } else {
      await this.client.removeObject(bucket, filename);
      console.log(`✓ Deleted from MinIO: ${bucketType}/${filename}`);
    }
  }

  /**
   * List files in bucket
   * @param {string} bucketType - Bucket type
   * @param {string} prefix - Optional prefix filter
   * @returns {Promise<Array>} List of objects
   */
  async list(bucketType, prefix = '') {
    await this.initialize();

    const bucket = this.buckets[bucketType];
    const objects = [];

    return new Promise((resolve, reject) => {
      const stream = this.client.listObjects(bucket, prefix, true);

      stream.on('data', (obj) => objects.push(obj));
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }

  /**
   * Check if file exists
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @returns {Promise<boolean>}
   */
  async exists(bucketType, filename) {
    try {
      await this.initialize();
      const bucket = this.buckets[bucketType];

      if (this.useS3) {
        const key = `${bucket}/${filename}`;
        const command = new HeadObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
        });

        await this.s3Client.send(command);
        return true;
      } else {
        await this.client.statObject(bucket, filename);
        return true;
      }
    } catch (error) {
      if (error.code === 'NotFound' || error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get object metadata
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @returns {Promise<Object>} Object stats
   */
  async getMetadata(bucketType, filename) {
    await this.initialize();
    const bucket = this.buckets[bucketType];
    return await this.client.statObject(bucket, filename);
  }

  /**
   * Generate pre-signed URL (temporary access)
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @param {number} expirySeconds - URL expiry time in seconds (default: 7 days)
   * @returns {Promise<string>} Pre-signed URL
   */
  async getPresignedUrl(bucketType, filename, expirySeconds = 7 * 24 * 60 * 60) {
    await this.initialize();
    const bucket = this.buckets[bucketType];

    if (this.useS3) {
      const key = `${bucket}/${filename}`;
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn: expirySeconds });
    } else {
      return await this.client.presignedGetObject(bucket, filename, expirySeconds);
    }
  }

  /**
   * Get public URL for object (if bucket is public)
   * @param {string} bucketType - Bucket type
   * @param {string} filename - File name
   * @returns {string} Public URL
   */
  getPublicUrl(bucketType, filename) {
    const bucket = this.buckets[bucketType];

    if (this.useS3) {
      const region = process.env.AWS_REGION || 'us-east-1';
      return `https://${this.s3Bucket}.s3.${region}.amazonaws.com/${bucket}/${filename}`;
    } else {
      const protocol = this.client.useSSL ? 'https' : 'http';
      const endpoint = this.client.host;
      const port = this.client.port === 80 || this.client.port === 443 ? '' : `:${this.client.port}`;

      return `${protocol}://${endpoint}${port}/${bucket}/${filename}`;
    }
  }
}

// Singleton instance
export const mediaStorage = new MediaStorage();
