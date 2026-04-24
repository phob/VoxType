export type ActiveWindowInfo = {
  hwnd: string;
  title: string;
  processId: number;
  processPath: string | null;
  processName: string | null;
};

export type WindowsHelperStatus = {
  available: boolean;
  helperPath: string | null;
  error: string | null;
};

