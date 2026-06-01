import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import type { Photo } from '../../core/model/types';
import { usePhotos } from '../../core/hooks/useData';
import { usePhotoMutations } from '../../core/hooks/useMutations';
import { Button } from '../primitives/Button';

interface UploadProgress {
  name: string;
  pct: number;
}

function uploadFile(file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

/** Photo management section for the phone Manage tab. Upload, browse thumbnails, preview + delete. */
export function PhotoManager() {
  const { data: photos, refetch } = usePhotos();
  const { remove } = usePhotoMutations();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [preview, setPreview] = useState<Photo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const photoList = photos ?? [];
  const count = photoList.length;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const initial = fileArray.map((f) => ({ name: f.name, pct: 0 }));
    setUploads(initial);

    await Promise.allSettled(
      fileArray.map((file, i) =>
        uploadFile(file, (pct) => {
          setUploads((prev) =>
            prev.map((u, j) => (j === i ? { ...u, pct } : u))
          );
        })
      )
    );

    setUploads([]);
    refetch();
  };

  const handleDelete = () => {
    if (!preview) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    remove.mutate(preview.id, {
      onSettled: () => {
        setPreview(null);
        setConfirmDelete(false);
      },
    });
  };

  const closePreview = () => {
    setPreview(null);
    setConfirmDelete(false);
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h2
        className="font-semibold text-text-muted"
        style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}
      >
        Photos
        <span
          className="font-normal"
          style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-faint)' }}
        >
          {count} photos &middot; max 500
        </span>
      </h2>

      {/* Upload button */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-md border border-border font-semibold"
        style={{ padding: '10px 16px', fontSize: 14, background: 'var(--surface)', color: 'var(--accent)' }}
      >
        <Upload size={16} />
        Upload photos
      </button>

      {/* Upload progress bars */}
      {uploads.length > 0 && (
        <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
          {uploads.map((u) => (
            <div key={u.name}>
              <div className="truncate" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {u.name}
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'var(--border)' }}>
                <div
                  className="rounded-full"
                  style={{ height: '100%', width: `${u.pct}%`, background: 'var(--accent)', transition: 'width 0.2s' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Thumbnail grid */}
      {count === 0 && uploads.length === 0 && (
        <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-faint)' }}>
          No photos yet. Upload some to display on the wall.
        </p>
      )}

      {count > 0 && (
        <div
          className="grid gap-2"
          style={{ marginTop: 12, gridTemplateColumns: 'repeat(3, 1fr)' }}
        >
          {photoList.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setPreview(photo)}
              className="rounded-md overflow-hidden"
              style={{ aspectRatio: '1', background: 'var(--border)' }}
            >
              <img
                src={photo.url}
                alt={photo.filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen preview overlay */}
      {preview && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center"
          style={{ zIndex: 100, background: 'rgba(0, 0, 0, 0.9)' }}
        >
          <img
            src={preview.url}
            alt={preview.filename}
            className="max-w-full max-h-[70vh] object-contain rounded-md"
          />
          <div className="flex gap-3" style={{ marginTop: 24 }}>
            <Button variant="danger" onClick={handleDelete} disabled={remove.isPending}>
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
            <Button variant="ghost" onClick={closePreview} style={{ color: '#fff', background: 'rgba(255,255,255,0.15)' }}>
              Close
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
