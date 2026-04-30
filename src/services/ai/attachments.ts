import type { Attachment } from '../../core/types';

export async function filesToAttachments(fileList: FileList | File[]): Promise<Attachment[]> {
  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));

  return Promise.all(
    files.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      mediaType: file.type,
      dataUrl: await readFileAsDataUrl(file),
    })),
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
