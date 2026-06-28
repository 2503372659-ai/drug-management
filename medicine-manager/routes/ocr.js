const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Tesseract = require("tesseract.js");

// Configure multer
const uploadDir = path.join(__dirname, "..", "data", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, "rx_" + Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".bmp", ".webp"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 JPG/PNG/BMP/WEBP 格式图片"));
    }
  }
});

// POST /api/ocr - Upload and recognize
router.post("/", (req, res, next) => {
  upload.single("image")(req, res, function(err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "图片大小不能超过10MB" });
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: "请上传图片文件" });

    processOCR(req.file.path, req.file.originalname, res);
  });
});

async function processOCR(filePath, originalName, res) {
  try {
    console.log("OCR processing:", originalName, "(" + Math.round(fs.statSync(filePath).size / 1024) + "KB)");
    
    const t0 = Date.now();
    let result;
    try {
      result = await Tesseract.recognize(filePath, "chi_sim", {
        logger: info => {
          if (info.status === "recognizing text") {
            console.log("OCR progress:", Math.round(info.progress * 100) + "%");
          }
        }
      });
    } catch (ocrErr) {
      console.error("Tesseract internal error:", ocrErr.message);
      fs.unlink(filePath, () => {});
      return res.status(500).json({ error: "图片识别失败，请确认为清晰处方照片。(" + ocrErr.message + ")" });
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    
    const rawText = result.data.text;
    console.log("OCR done in " + elapsed + "s, text length:", rawText.length);

    const parsed = parsePrescription(rawText);
    
    fs.unlink(filePath, () => {});
    res.json({ success: true, raw_text: rawText, data: parsed });
  } catch (e) {
    console.error("OCR process error:", e.message);
    try { fs.unlink(filePath, () => {}); } catch(e2) {}
    res.status(500).json({ error: "识别失败：" + (e.message || "未知错误") });
  }
}

// ====== 处方智能解析引擎 ======
function parsePrescription(text) {
  const result = {
    patient_name: "", gender: "", age: "", insurance: "",
    hospital: "", diagnosis: "", medications: [], prescription_date: ""
  };

  if (!text || text.trim().length === 0) return result;

  const fullText = text.replace(/\\s+/g, "");
  const lines = text.split("\\n").filter(l => l.trim());

  // --- 患者姓名 ---
  const namePatterns = [
    /姓名[：:]\\s*([^\\s,，、\\d]{2,4})/,
    /患者[：:]\\s*([^\\s,，、\\d]{2,4})/,
    /病人[：:]\\s*([^\\s,，、\\d]{2,4})/,
    /患[者者][：:]?\\s*([\\u4e00-\\u9fa5]{2,4})/
  ];
  for (const p of namePatterns) {
    const m = fullText.match(p);
    if (m && m[1]) { result.patient_name = m[1].trim(); break; }
  }
  // Fallback: look for any 2-4 char Chinese name near "姓名" context
  if (!result.patient_name) {
    const fn = fullText.match(/姓名[：:]?\\s*([\\u4e00-\\u9fa5]{2,4})/);
    if (fn) result.patient_name = fn[1];
  }

  // --- 性别 ---
  const gm = fullText.match(/性别[：:]\\s*([男女])/);
  if (gm) result.gender = gm[1];

  // --- 年龄 ---
  const am = fullText.match(/年龄[：:]\\s*(\\d+)/);
  if (am) result.age = am[1];

  // --- 医保 ---
  const insTypes = { "城镇职工": "城镇职工", "城乡居民": "城乡居民", "新农合": "新农合", "自费": "自费" };
  for (const [key, val] of Object.entries(insTypes)) {
    if (fullText.includes(key)) { result.insurance = val; break; }
  }
  if (!result.insurance && fullText.includes("医保")) result.insurance = "城镇职工";

  // --- 医院 ---
  const hm = fullText.match(/([\\u4e00-\\u9fa5]{2,}(?:医院|卫生院|诊所|医疗中心))/);
  if (hm) result.hospital = hm[1];

  // --- 诊断 ---
  const diagPatterns = [/诊断[：:]\\s*([^\\n]{1,30})/, /临床诊断[：:]\\s*([^\\n]{1,30})/];
  for (const p of diagPatterns) {
    const m = text.match(p);
    if (m && m[1]) { result.diagnosis = m[1].trim(); break; }
  }

  // --- 日期 ---
  const dm = fullText.match(/(\\d{4})\\s*[-年\\/.](\\d{1,2})\\s*[-月\\/.](\\d{1,2})/);
  if (dm) result.prescription_date = dm[1] + "-" + dm[2].padStart(2, "0") + "-" + dm[3].padStart(2, "0");

  // --- 药品 ---
  const drugSection = findDrugSection(text);
  const drugLines = drugSection ? drugSection.split("\\n").filter(l => l.trim()) : lines;
  const drugKeywords = ["片", "胶囊", "丸", "颗粒", "口服液", "注射液", "滴丸", "缓释片", "控释片", "分散片", "软胶囊", "合剂"];

  for (const line of drugLines) {
    const t = line.trim();
    if (t.length < 2 || isHeaderLine(t)) continue;
    
    const hasDrugKw = drugKeywords.some(k => t.includes(k));
    const isChinese = /[\\u4e00-\\u9fa5]/.test(t);
    
    if (hasDrugKw && isChinese) {
      const drug = extractDrugInfo(t);
      if (drug && drug.name && drug.name.length >= 2) {
        result.medications.push(drug);
      }
    }
  }

  // Fallback: try broader matching
  if (result.medications.length === 0) {
    for (const line of drugLines) {
      const t = line.trim();
      if (t.length < 2 || isHeaderLine(t) || /^\\d/.test(t)) continue;
      if (/[\\u4e00-\\u9fa5]/.test(t)) {
        const drug = extractDrugInfo(t);
        if (drug && drug.name && drug.name.length >= 2) {
          if (!result.medications.some(m => m.name === drug.name)) {
            result.medications.push(drug);
          }
        }
      }
    }
  }

  return result;
}

function findDrugSection(text) {
  const lines = text.split("\\n");
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^R[Pp]?\\s*[：:]/.test(l) || /^Rp|^处方[：:]/.test(l)) { start = i + 1; break; }
  }
  if (start < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (["用法用量", "用药方案", "处方用药"].some(k => lines[i].includes(k))) { start = i + 1; break; }
    }
  }
  if (start < 0) return lines.join("\\n");
  for (let i = start; i < lines.length; i++) {
    if (["医师签名", "医生签名", "医师", "药师", "审核", "调配"].some(k => lines[i].includes(k))) { end = i; break; }
  }
  return lines.slice(start, end).join("\\n");
}

function extractDrugInfo(line) {
  const result = { name: "", specification: "", quantity: 0, daily_dosage: 0, unit: "片", frequency: "" };
  let clean = line.replace(/^[\\d\\s.、，,]+/, "").trim();

  // Extract quantity
  const qm = clean.match(/[×xX*]\\s*(\\d+\\.?\\d*)\\s*(盒|瓶|袋|支|片|粒|包)?$/);
  if (qm) {
    result.quantity = parseFloat(qm[1]);
    if (qm[2]) result.unit = qm[2];
    clean = clean.substring(0, clean.indexOf(qm[0]));
  }

  // Specification
  const specMatch = clean.match(/(\\d+\\.?\\d*\\s*mg\\s*[*×xX]\\s*\\d+\\s*片)|(\\d+\\.?\\d*\\s*m?g)/);
  if (specMatch) {
    result.specification = specMatch[0];
    clean = clean.replace(specMatch[0], "").trim();
  }

  clean = clean.replace(/规格|用法|用量/g, "").trim();
  
  const nameMatch = clean.match(/([\\u4e00-\\u9fa5a-zA-Z]+)/);
  if (nameMatch) result.name = nameMatch[1];

  // Daily dosage
  const dailyMatch = clean.match(/(?:每次|一次|一日|每天)\\s*(\\d+\\.?\\d*)\\s*(片|粒|支|ml|毫升|袋|包)/);
  if (dailyMatch) {
    result.daily_dosage = parseFloat(dailyMatch[1]);
    if (dailyMatch[2]) result.unit = dailyMatch[2];
  }

  // Frequency
  const freqMatch = clean.match(/(?:每日|一天|一日|每天)\\s*(\\d+)\\s*/);
  if (freqMatch) {
    result.frequency = "每日" + freqMatch[1] + "次";
    if (result.daily_dosage > 0) {
      result.daily_dosage = result.daily_dosage * parseInt(freqMatch[1]);
    } else {
      const pd = clean.match(/每次\\s*(\\d+\\.?\\d*)\\s*(片|粒|支|ml|袋|包)/);
      if (pd) {
        result.daily_dosage = parseFloat(pd[1]) * parseInt(freqMatch[1]);
        if (pd[2]) result.unit = pd[2];
      }
    }
  }

  if (result.name) result.name = result.name.replace(/[（(].*[）)]$/, "").trim();
  return result;
}

function isHeaderLine(line) {
  return ["药品名称", "规格", "数量", "用法用量", "单次用量", "途径", "频率", "医师签名", "医生签名", "审核", "调配", "发药", "日期", "临床诊断", "诊断", "姓名", "性别", "年龄", "Rp", "R:"].some(k => line.includes(k));
}

module.exports = router;
