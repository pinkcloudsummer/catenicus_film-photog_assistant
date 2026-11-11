declare module 'piexifjs' {
  const piexif: {
    load(jpegData: string): any;
    dump(exifDict: any): string;
    insert(exifBytes: string, jpegData: string): string;
    ImageIFD: Record<string, number>;
    ExifIFD: Record<string, number>;
    GPSIFD: Record<string, number>;
    GPSHelper: {
      degToDmsRational(degFloat: number): [[number, number], [number, number], [number, number]];
    };
  };
  export default piexif;
}
