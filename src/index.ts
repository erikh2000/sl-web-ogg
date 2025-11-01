import Module from '../wasm/middle-layer';
import {P, P32, EncodeTag, EncodeOptions} from "./types";
import {tagsToBuffer, bufferToTags} from "./tagUtil";

export type {EncodeTag, EncodeOptions} from "./types";

const DEFAULT_ENCODE_OPTIONS:EncodeOptions = {
  quality: .5,
  tags: []
};

const {_clearEncoder, _createAnalysisBuffer, _decodeComments, _initEncoder, _processEncoding, _getEncodedDataLen, _transferEncodedData, ANALYSIS_SAMPLE_COUNT} = Module;

let waitForModuleInitPromise:Promise<void>|null = null;
async function _waitForModuleInit():Promise<void> {
  if (Module._isInitialized) return; // Module has already been initialized.
  if (Module._isInitialized === undefined) throw Error('Unexpected behavior from middle-layer.js import.'); // middle-layer.js should have a preRun() function that sets Module._isInitialized to false. If it's not there, then the WASM build for middle-layer is probably wrong.
  if (waitForModuleInitPromise !== null) return await waitForModuleInitPromise; // Module is already being initialized.
  waitForModuleInitPromise = new Promise<void>((resolve) => { // Module has not yet been initialized.
    Module.onRuntimeInitialized = resolve();
  });
  return waitForModuleInitPromise;
}

function _init(audioBuffer:AudioBuffer, quality:number, tagsBuffer:P):P {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  return _initEncoder(channelCount, sampleRate, quality, tagsBuffer);
}

function _getChannelSampleBuffers(audioBuffer:AudioBuffer):Float32Array[] {
  const channelCount = audioBuffer.numberOfChannels;
  const channelSampleBuffers:Float32Array[] = [];
  for(let channelI = 0; channelI < channelCount; ++channelI) {
    channelSampleBuffers[channelI] = audioBuffer.getChannelData(channelI);
  }
  return channelSampleBuffers;
}

function _processAndTransferData(pEncoderState:P, sampleCount:number):Uint8Array {
  _processEncoding(pEncoderState, sampleCount);
  const oggBytesLength = _getEncodedDataLen(pEncoderState);
  if (oggBytesLength === 0) return new Uint8Array(0);
  const pOggBytes = _transferEncodedData(pEncoderState);
  return new Uint8Array(Module.HEAPU8.subarray(pOggBytes, pOggBytes + oggBytesLength));
}

function _processSampleBufferChunk(pEncoderState:P, channelSampleBuffers:Float32Array[], fromSampleNo:number, fromSampleCount:number, p32AnalysisBuffer:P32):Uint8Array {
  if (p32AnalysisBuffer === null) throw Error('Unexpected');
  
  const fromSampleNoEnd = fromSampleNo + fromSampleCount;
  for(let channelI = 0; channelI < channelSampleBuffers.length; ++channelI) {
    const channelSamples = channelSampleBuffers[channelI];
    const p32ChannelAnalysisBuffer= Module.HEAPU32[p32AnalysisBuffer + channelI] >> 2;
    Module.HEAPF32.set(channelSamples.subarray(fromSampleNo, fromSampleNoEnd), p32ChannelAnalysisBuffer);
  }
  return _processAndTransferData(pEncoderState, fromSampleCount);
}

function _yield():Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function _finishProcessing(pEncoderState:P):Uint8Array {
  return _processAndTransferData(pEncoderState, 0);
}

function _fillInDefaults(encodeOptions:Partial<EncodeOptions>):EncodeOptions {
  if (encodeOptions === DEFAULT_ENCODE_OPTIONS) return DEFAULT_ENCODE_OPTIONS;
  const useOptions:any = {...DEFAULT_ENCODE_OPTIONS};
  const encodeOptionsAny = encodeOptions as any;
  for(const key in encodeOptions) {
    if (encodeOptionsAny[key] !== undefined) useOptions[key] = encodeOptionsAny[key];
  }
  return useOptions;
}

async function _decodeOggArrayBuffer(arrayBuffer:ArrayBuffer, audioContext?:AudioContext):Promise<AudioBuffer> {
  const useAudioContext = audioContext ?? new AudioContext(); // Requires a user gesture on browser, e.g., clicking a button.
  return await useAudioContext.decodeAudioData(arrayBuffer); // Returns AudioBuffer. This call detaches the arrayBuffer, making it unusable for most things.
}

function _decodeOggArrayBufferTags(arrayBuffer:ArrayBuffer):EncodeTag[] {
  let pOggBytes:P = null, pComments:P = null;
  try {
    const oggBytes = new Uint8Array(arrayBuffer);
    pOggBytes = Module._malloc(oggBytes.length);
    Module.HEAPU8.set(oggBytes, pOggBytes);
    pComments = _decodeComments(pOggBytes, oggBytes.length);
    return bufferToTags(pComments, Module);
  } finally {
    if (pComments !== null) Module._free(pComments);
    if (pOggBytes !== null) Module._free(pOggBytes);
  }
}

/**
 * Encodes an AudioBuffer to an Ogg blob.
 * 
 * @param {AudioBuffer} audioBuffer AudioBuffer to encode to Ogg.
 * @param {EncodeOptions} encodeOptions An optional object where you can set the following members:
 *    quality: A number between 0 and 1. Default is .5.
 *    tags: An array of objects with "tag" and "value" members containing strings. "tag" values can't contain 
 *          tabs ('\t') or equal signs ("="). "value" values can't contain tabs.
 * @throws {Error} If tags in an invalid format were passed or something unexpected happens.
 * @returns {Promise<Blob>} A Blob containing the encoded Ogg file.
 */
export async function encodeAudioBuffer(audioBuffer:AudioBuffer, encodeOptions:Partial<EncodeOptions> = DEFAULT_ENCODE_OPTIONS):Promise<Blob> {
  let pEncoderState:P = null;
  const oggByteBuffers: BlobPart[] = [];
  const options = _fillInDefaults(encodeOptions);
  let tagsBuffer:P = null;

  try {
    await _waitForModuleInit();

    tagsBuffer = tagsToBuffer(options.tags, Module);
    const sampleCount = audioBuffer.length;
    pEncoderState = _init(audioBuffer, options.quality, tagsBuffer);
    const channelSampleBuffers = _getChannelSampleBuffers(audioBuffer);

    let fromSampleNo = 0;
    if (pEncoderState === null) throw Error('Unexpected');
    while(fromSampleNo < sampleCount) {
      const p32AnalysisBuffer= _createAnalysisBuffer(pEncoderState) >> 2;
      const fromSampleCount = Math.min(ANALYSIS_SAMPLE_COUNT, sampleCount - fromSampleNo);
      const oggBytes = _processSampleBufferChunk(pEncoderState, channelSampleBuffers, fromSampleNo, fromSampleCount, p32AnalysisBuffer);
      if (oggBytes.length) oggByteBuffers.push(oggBytes.slice().buffer);
      fromSampleNo += fromSampleCount;
      await _yield();
    }

    const lastOggBytes = _finishProcessing(pEncoderState);
    if (lastOggBytes.length) oggByteBuffers.push(lastOggBytes.slice().buffer);
    return new Blob(oggByteBuffers, {type:'audio/ogg'});
  } finally {
    if (pEncoderState !== null) _clearEncoder(pEncoderState);
    if (tagsBuffer !== null) Module._free(tagsBuffer);
  }
}

/** 
 *  Decode an Ogg file from a Blob to an AudioBuffer. This depends on the browser's AudioContext.decodeAudioData() 
 *  function. On some browsers, this function may require a user gesture, e.g., clicking a button. before it can be
 *  called successfully. If you are creating a lot of AudioContexts in your app, you may want to reuse the same
 *  AudioContext instance by passing it as a param. It's a good practice for cross-browser compatibility.
 *  
 *  @param {Blob} blob The Ogg file to decode.
 *  @param {AudioContext} audioContext Optional. If not provided, a new AudioContext will be created.
 *  @throws {Error} If the file is in an unexpected format, the browser needs a user gesture, or something unexpected.
 *  @returns {Promise<AudioBuffer>} Populated with the decoded audio data.
 */
export async function decodeOggBlob(blob:Blob, audioContext?:AudioContext):Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return await _decodeOggArrayBuffer(arrayBuffer, audioContext);
}

/**
 * Decode an Ogg file from a Blob to an AudioBuffer and tags. This depends on the browser's AudioContext.decodeAudioData()
 * function. On some browsers, this function may require a user gesture, e.g., clicking a button. before it can be
 * called successfully. If you are creating a lot of AudioContexts in your app, you may want to reuse the same
 * AudioContext instance by passing it as a param. It's a good practice for cross-browser compatibility.
 *
 *  @param {Blob} blob The Ogg file to decode.
 *  @param {AudioContext} audioContext Optional. If not provided, a new AudioContext will be created.
 *  @throws {Error} If the file is in an unexpected format, the browser needs a user gesture, or something unexpected.
 *  @returns {Promise<Array>} Array where first element is the decoded audioBuffer and the second element is an array of 
 *      objects with "tag" and "value" members containing strings.
 */
 export async function decodeOggBlobWithTags(blob:Blob, audioContext?:AudioContext):Promise<[audioBuffer:AudioBuffer, tags:EncodeTag[]]> {
  await _waitForModuleInit();
  const arrayBuffer = await blob.arrayBuffer();
  const tags:EncodeTag[] = _decodeOggArrayBufferTags(arrayBuffer); // Must be called before _decodeOggArrayBuffer() which detaches the arrayBuffer. 
  const audioBuffer = await _decodeOggArrayBuffer(arrayBuffer, audioContext);
  return [audioBuffer, tags];
}