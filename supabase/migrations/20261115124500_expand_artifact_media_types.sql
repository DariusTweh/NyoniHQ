-- Production Core persists generated audio and video beside existing image artifacts.
-- Keep the bucket public for the existing founder-review player and permit only
-- the media types the current production adapters emit.
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/ogg',
    'video/mp4',
    'application/zip'
  ]::text[]
where id = 'nyoni-artifacts';
