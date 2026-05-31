import { z } from 'zod/v4';

/**
 * Secret payload schemas — these define the shape of the JSON that is
 * encrypted client-side and stored as ciphertext in the DB.
 *
 * All schemas use .strict() so unknown keys are rejected on parse.
 */

export const LoginPayloadSchema = z
  .object({
    username: z.string(),
    password: z.string(),
    url: z.string().optional(),
    totp_secret: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const NotePayloadSchema = z
  .object({
    content: z.string(),
  })
  .strict();

export const EnvVarPayloadSchema = z
  .object({
    variables: z.array(
      z
        .object({
          key: z.string(),
          value: z.string(),
        })
        .strict(),
    ),
    project: z.string().optional(),
    environment: z.enum(['development', 'staging', 'production']).optional(),
  })
  .strict();

export const FilePayloadSchema = z
  .object({
    filename: z.string(),
    mime_type: z.string(),
    size: z.number().int().nonnegative(),
    /** Reference to object storage — the file itself is AES-256-GCM encrypted */
    storage_key: z.string(),
    /** Base64 IV used to encrypt the file blob */
    file_iv: z.string(),
  })
  .strict();

export const CardPayloadSchema = z
  .object({
    number: z.string(),
    cardholder: z.string(),
    expiry: z.string(),
    cvv: z.string(),
    notes: z.string().optional(),
  })
  .strict();

export const SecretPayloadSchema = z.discriminatedUnion('_type', [
  LoginPayloadSchema.extend({ _type: z.literal('login') }),
  NotePayloadSchema.extend({ _type: z.literal('note') }),
  EnvVarPayloadSchema.extend({ _type: z.literal('env_var') }),
  FilePayloadSchema.extend({ _type: z.literal('file') }),
  CardPayloadSchema.extend({ _type: z.literal('card') }),
]);

// ---- Inferred TypeScript types ----
export type LoginPayload = z.infer<typeof LoginPayloadSchema>;
export type NotePayload = z.infer<typeof NotePayloadSchema>;
export type EnvVarPayload = z.infer<typeof EnvVarPayloadSchema>;
export type FilePayload = z.infer<typeof FilePayloadSchema>;
export type CardPayload = z.infer<typeof CardPayloadSchema>;
export type SecretPayload = z.infer<typeof SecretPayloadSchema>;

/** The secret types that exist in the DB */
export const SECRET_TYPES = ['login', 'note', 'file', 'env_var', 'card'] as const;
export type SecretType = (typeof SECRET_TYPES)[number];
