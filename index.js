/**
 * 使用 sharp 裁剪图片（保留中间338像素宽度）并使用 @squoosh/lib 压缩
 * * 安装依赖：npm install @squoosh/lib sharp
 * 使用方法：node compress-images.js
 */

const fs = require('fs');
const path = require('path');
const { ImagePool } = require('@squoosh/lib');
const sharp = require('sharp');

// ========== 配置区域 ==========
const CONFIG = {
  inputDir: './jump',           // 输入文件夹路径
  outputDir: './jumpCompress',  // 输出文件夹路径
  
  // 裁剪设置
  crop: {
    enabled: true,
    width: 1305,                 // 裁剪到338像素宽度
  },
  
  // 压缩设置
  encodeOptions: {
    oxipng: {
      level: 2,
    },
    mozjpeg: {
      quality: 80,
      progressive: true,
    },
    webp: {
      quality: 80,
      method: 4,
    }
  },
  
  // 预处理选项（仅用于 @squoosh/lib）
  preprocessOptions: {
    // 调整大小（可选）
    resize: {
      enabled: true,
      width: 338,
      height: 280,
    },
    // 缩减调色板
    quant: {
      enabled: true,
      numColors: 64,
      dither: 1.0,
    }
  },
  
  formats: ['.jpg', '.jpeg', '.png'], // 支持的输入格式
  outputFormat: null,                 // 输出格式，null表示保持原格式
  maxConcurrent: 4,                   // 最大并发数
};

// ========== 工具函数 ==========

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

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
 * 使用 sharp 裁剪图片
 */
async function cropImage(inputBuffer) {
  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();
    
    if (!metadata.width || metadata.width <= CONFIG.crop.width) {
      return inputBuffer; // 如果图片宽度小于或等于338像素，直接返回原缓冲区
    }
    
    const xOffset = Math.floor((metadata.width - CONFIG.crop.width) / 2);
    
    return await image
      .extract({
        left: xOffset,
        top: 0,
        width: CONFIG.crop.width,
        height: metadata.height
      })
      .toBuffer();
  } catch (error) {
    throw new Error(`裁剪失败: ${error.message}`);
  }
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
  
  console.log(`开始处理 ${imageFiles.length} 个图片...\n`);
  
  const imagePool = new ImagePool(CONFIG.maxConcurrent);

  for (let i = 0; i < imageFiles.length; i++) {
    const inputPath = imageFiles[i];
    const relativePath = path.relative(CONFIG.inputDir, inputPath);
    
    try {
      console.log(`[${i + 1}/${imageFiles.length}] ${relativePath}`);
      
      // 读取文件
      const inputBuffer = fs.readFileSync(inputPath);
      const inputSize = inputBuffer.length;
      stats.totalInputSize += inputSize;
      
      // 裁剪图片
      let processedBuffer = inputBuffer;
      if (CONFIG.crop.enabled) {
        processedBuffer = await cropImage(inputBuffer);
      }
      
      // 加载图片到 ImagePool
      const image = imagePool.ingestImage(processedBuffer);
      
      // 预处理
      const preprocessOpts = {};
      
      // 调整大小
      if (CONFIG.preprocessOptions.resize.enabled) {
        preprocessOpts.resize = CONFIG.preprocessOptions.resize;
      }
      
      // 缩减调色板
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
      console.error(`  ✗ 失败: ${error.message} (${relativePath})\n`);
      stats.failed++;
    }
  }
  
  await imagePool.close();
  return stats;
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('    图片裁剪与压缩工具（sharp + squoosh）');
  console.log('========================================\n');
  
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
  
  // 处理图片（裁剪 + 压缩）
  const stats = await compressImages(imageFiles);
  
  // 输出统计
  console.log('========================================');
  console.log('裁剪与压缩完成！\n');
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