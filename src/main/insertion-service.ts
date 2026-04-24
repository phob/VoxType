import { clipboard } from "electron";

export class InsertionService {
  async copyForInsertion(text: string): Promise<void> {
    clipboard.writeText(text);
  }
}

