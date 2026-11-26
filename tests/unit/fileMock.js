/**
 * 图片在单测里的替身：清单里 `require('.../xxx.png')` 只要有个字符串即可，
 * 真正的文件存在性由 `manifestTextureFiles` 逐条核对。
 */
module.exports = 'test-texture.png';
