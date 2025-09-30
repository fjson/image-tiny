/**
 * 使用 @squoosh/lib 批量压缩图片并裁剪
 * 
 * 安装依赖：npm install @squoosh/lib
 * 使用方法：node compress-images.js
 */

const fs = require('fs');
const path = require('path');
const { ImagePool } = require('@squoosh/lib');

// ========== 配置区域 ==========
const CONFIG = {
  inputDir: './jump',           // 输入文件夹路径
  outputDir: './jumpCompress',      // 输出文件夹路径
  
  // 压缩设置
  encodeOptions: {
    // 使用 OxiPNG 压缩 PNG
    oxipng: {
      level: 2,                   // 压缩级别 0-6
    },
    // 或使用 MozJPEG 压缩 JPEG
    mozjpeg: {
      quality: 80,                // 质量 0-100
      progressive: true,
    },
    // 或使用 WebP
    webp: {
      quality: 80,
      method: 4,                  // 压缩方法 0-6
    }
  },
  
  // 预处理选项
  preprocessOptions: {
    // 调整大小
    resize: {
      enabled: true,
      width: 338,                 // 修改为338
      height: 280,
    },
    // 缩减调色板（Reduce palette）- 关键压缩选项！
    quant: {
      enabled: true,              // 是否启用调色板缩减
      numColors: 128,             // 颜色数量 2-256
      dither: 1.0,                // 抖动强度 0-1
    }
  },
  
  // 裁剪设置 - 新增
  cropOptions: {
    enabled: true,                // 是否启用裁剪
    width: 338,                   // 裁剪宽度
    keepHeight: true,             // 保持原始高度
  },
  
  formats: ['.jpg', '.jpeg', '.png'], // 支持的输入格式
  outputFormat: null,              // 输出格式，null表示保持原格式
  maxConcurrent: 4,                // 最大并发数
};

// ========== 工具函数 ==========

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 格式化文件大小
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * 获取所有图片文件
 */
function getImageFiles(dir) {
  const files = [];
  
  function readDir(currentPath) {
    const items = fs.readdirSync(currentPath);
    
    items.forEach(item => {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        readDir(fullPath);
      } else {
        const ext = path.extname(item).toLowerCase();
        if (CONFIG.formats.includes(ext)) {
          files.push(fullPath);
        }
      }
    });
  }
  
  readDir(dir);
  return files;
}

/**
 * 获取编码器类型
 */
function getEncoder(filePath, customFormat) {
  const ext = (customFormat || path.extname(filePath)).toLowerCase();
  
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'mozjpeg';
    case '.png':
      return 'oxipng';
    case '.webp':
      return 'webp';
    default:
      return 'oxipng';
  }
}

/**
 * 获取输出路径
 */
function getOutputPath(inputPath, customFormat) {
  const relativePath = path.relative(CONFIG.inputDir, inputPath);
  const parsed = path.parse(relativePath);
  
  if (customFormat) {
    parsed.ext = customFormat;
    parsed.base = parsed.name + customFormat;
  }
  
  return path.join(CONFIG.outputDir, parsed.dir, parsed.base);
}

/**
 * 压缩图片
 */
async function compressImages(imageFiles) {
  const stats = {
    total: imageFiles.length,
    success: 0,
    failed: 0,
    totalInputSize: 0,
    totalOutputSize: 0,
  };
  
  console.log(`开始压缩 ${imageFiles.length} 个图片...\n`);
  
  for (let i = 0; i < imageFiles.length; i++) {
    const imagePool = new ImagePool(CONFIG.maxConcurrent);
    const inputPath = imageFiles[i];
    const relativePath = path.relative(CONFIG.inputDir, inputPath);
    
    try {
      console.log(`[${i + 1}/${imageFiles.length}] ${relativePath}`);
      
      // 读取文件
      const inputBuffer = fs.readFileSync(inputPath);
      const inputSize = inputBuffer.length;
      stats.totalInputSize += inputSize;
      
      // 加载图片到 ImagePool
      const image = imagePool.ingestImage(inputBuffer);
      
      // 获取原始图片尺寸
      await image.decoded;
      const originalWidth = image.bitmap.width;
      const originalHeight = image.bitmap.height;
      
      console.log(`  原始尺寸: ${originalWidth}x${originalHeight}`);
      
      // 预处理
      const preprocessOpts = {};
      
      // 裁剪（保留中间338像素宽度）
      if (CONFIG.cropOptions.enabled && originalWidth > CONFIG.cropOptions.width) {
        const cropWidth = CONFIG.cropOptions.width;
        const cropHeight = CONFIG.cropOptions.keepHeight ? originalHeight : CONFIG.preprocessOptions.resize.height;
        const left = Math.floor((originalWidth - cropWidth) / 2);
        
        preprocessOpts.resize = {
          enabled: true,
          width: cropWidth,
          height: cropHeight,
          method: 'lanczos3',
          fitMethod: 'stretch',
          premultiply: true,
          linearRGB: true,
        };
        
        console.log(`  裁剪: 保留中间${cropWidth}px宽度，偏移${left}px`);
      } else if (CONFIG.preprocessOptions.resize.enabled) {
        // 如果不需要裁剪，使用原有的resize设置
        preprocessOpts.resize = CONFIG.preprocessOptions.resize;
      }
      
      // 缩减调色板（Reduce palette）
      if (CONFIG.preprocessOptions.quant.enabled) {
        preprocessOpts.quant = {
          enabled: true,
          numColors: CONFIG.preprocessOptions.quant.numColors,
          dither: CONFIG.preprocessOptions.quant.dither,
        };
      }
      
      // 执行预处理
      if (Object.keys(preprocessOpts).length > 0) {
        await image.preprocess(preprocessOpts);
      }
      
      // 获取编码器
      const encoder = getEncoder(inputPath, CONFIG.outputFormat);
      const encodeOptions = CONFIG.encodeOptions[encoder];
      
      // 编码
      await image.encode({
        [encoder]: encodeOptions
      });
      
      // 获取压缩后的数据
      const encodedImage = await image.encodedWith[encoder];
      const outputBuffer = encodedImage.binary;
      const outputSize = outputBuffer.length;
      stats.totalOutputSize += outputSize;
      
      // 保存文件
      const outputPath = getOutputPath(inputPath, CONFIG.outputFormat);
      ensureDir(path.dirname(outputPath));
      fs.writeFileSync(outputPath, outputBuffer);
      
      // 计算压缩率
      const reduction = ((1 - outputSize / inputSize) * 100).toFixed(2);
      
      console.log(`  ✓ ${formatBytes(inputSize)} → ${formatBytes(outputSize)} (减少 ${reduction}%)`);
      console.log(`  保存到: ${outputPath}\n`);
      
      stats.success++;
      
    } catch (error) {
      console.error(`  ✗ 失败: ${error.message}\n`);
      stats.failed++;
    } finally {
      await imagePool.close();
    }
  }
 
  return stats;
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('    Squoosh 批量图片压缩与裁剪工具');
  console.log('========================================\n');
  
  console.log('配置信息:');
  console.log(`  输入目录: ${CONFIG.inputDir}`);
  console.log(`  输出目录: ${CONFIG.outputDir}`);
  if (CONFIG.cropOptions.enabled) {
    console.log(`  裁剪设置: 保留中间${CONFIG.cropOptions.width}px宽度`);
  }
  console.log('');
  
  // 检查输入目录
  if (!fs.existsSync(CONFIG.inputDir)) {
    console.error(`✗ 错误: 输入目录不存在: ${CONFIG.inputDir}`);
    process.exit(1);
  }
  
  // 确保输出目录存在
  ensureDir(CONFIG.outputDir);
  
  // 获取所有图片文件
  console.log(`正在扫描目录: ${CONFIG.inputDir}\n`);
  const imageFiles = getImageFiles(CONFIG.inputDir);
  
  if (imageFiles.length === 0) {
    console.log('✗ 未找到图片文件');
    process.exit(0);
  }
  
  console.log(`找到 ${imageFiles.length} 个图片文件\n`);
  
  // 压缩图片
  const stats = await compressImages(imageFiles);
  
  // 输出统计
  console.log('========================================');
  console.log('压缩完成！\n');
  console.log(`成功: ${stats.success} 个`);
  console.log(`失败: ${stats.failed} 个`);
  console.log(`总大小: ${formatBytes(stats.totalInputSize)} → ${formatBytes(stats.totalOutputSize)}`);
  
  if (stats.totalInputSize > 0) {
    const totalReduction = ((1 - stats.totalOutputSize / stats.totalInputSize) * 100).toFixed(2);
    console.log(`节省空间: ${formatBytes(stats.totalInputSize - stats.totalOutputSize)} (${totalReduction}%)`);
  }
  
  console.log('========================================');
}

// 执行
main().catch(error => {
  console.error('发生错误:', error);
  process.exit(1);
});