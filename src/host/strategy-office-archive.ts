import unzipper from 'unzipper';
import { StrategyDiscussionFault } from './strategy-discussion-store.ts';

/** Office files are containers. Bound the package before passing it to a document decoder. */
export async function inspectStrategyOfficeArchive(bytes:Buffer):Promise<string[]> {
  let files;
  try { ({files} = await unzipper.Open.buffer(bytes)); }
  catch { throw new StrategyDiscussionFault('strategy_attachment_invalid_document',422); }
  let total=0;
  if(files.length>6000)throw new StrategyDiscussionFault('strategy_attachment_expansion_limit',413);
  for(const file of files){
    total+=file.uncompressedSize;
    if(!Number.isSafeInteger(file.uncompressedSize)||file.uncompressedSize<0||file.uncompressedSize>24*1024*1024||total>96*1024*1024)
      throw new StrategyDiscussionFault('strategy_attachment_expansion_limit',413);
  }
  return files.map(file=>file.path);
}
