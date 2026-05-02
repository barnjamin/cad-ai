declare module '../../vendor/openscad-wasm/openscad.js' {
  type OpenScadModuleOptions = {
    noInitialRun?: boolean;
    wasmBinary?: Uint8Array;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  };

  type OpenScadInstance = {
    FS: {
      writeFile: (path: string, data: string | Uint8Array) => void;
      readFile: (path: string, options?: { encoding?: 'binary' }) => Uint8Array;
      unlink: (path: string) => void;
    };
    callMain: (args: string[]) => number;
  };

  export default function openscad(options?: OpenScadModuleOptions): Promise<OpenScadInstance>;
}
