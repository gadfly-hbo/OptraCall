declare module 'unzipper' {
  const unzipper: { Open: { buffer(bytes:Buffer): Promise<{files:{path:string;uncompressedSize:number}[]}> } };
  export default unzipper;
}
