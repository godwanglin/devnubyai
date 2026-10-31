export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfSelectedArea {
  pageNumber: number;
  rect: PdfRect;
  text: string;
}

export interface PdfLiveEdit {
  id: string;
  pageNumber: number;
  rect: PdfRect;
  originalText: string;
  replacementText: string;
  createdAt: number;
}
