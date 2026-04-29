export const WEB_UPLOAD_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_UPLOAD_BUCKET || 'birdbrain-uploads';
export const WEB_UPLOAD_MAX_MB = Number(process.env.NEXT_PUBLIC_BIRDBRAIN_WEB_UPLOAD_MAX_MB || 100);
export const WEB_UPLOAD_MAX_BYTES = WEB_UPLOAD_MAX_MB * 1024 * 1024;
