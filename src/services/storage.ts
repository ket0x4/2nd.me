import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';

type MediaCategory = 'audio' | 'images' | 'docs';

class StorageService {
  private baseDir: string;

  constructor(baseDir = env.STORAGE_DIR) {
    this.baseDir = baseDir;
  }

  public async init(): Promise<void> {
    await mkdir(join(this.baseDir, 'audio'), { recursive: true });
    await mkdir(join(this.baseDir, 'images'), { recursive: true });
    await mkdir(join(this.baseDir, 'docs'), { recursive: true });
  }

  public async saveMedia(
    category: MediaCategory,
    originalFilename: string,
    data: Buffer | Uint8Array,
  ): Promise<string> {
    await this.init();

    const sanitized = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}_${sanitized}`;
    const relativePath = join(category, filename);
    const fullPath = join(this.baseDir, relativePath);

    await writeFile(fullPath, data);
    return relativePath;
  }

  public getFullPath(relativePath: string): string {
    return join(this.baseDir, relativePath);
  }

  public async readMedia(relativePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(relativePath);
    return readFile(fullPath);
  }
}

export const storageService = new StorageService();
