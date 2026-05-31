import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

const s3 = new S3Client({
  endpoint: env.STORAGE_ENDPOINT,
  region: env.STORAGE_REGION,
  credentials: {
    accessKeyId: env.STORAGE_ACCESS_KEY,
    secretAccessKey: env.STORAGE_SECRET_KEY,
  },
  forcePathStyle: true,
});

const PRESIGN_TTL = 900; // 15 minutes

export function createPresignedPutUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }),
    { expiresIn: PRESIGN_TTL },
  );
}

export function createPresignedGetUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }),
    { expiresIn: PRESIGN_TTL },
  );
}
