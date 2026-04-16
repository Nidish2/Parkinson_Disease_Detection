import { mongodb } from '../lib/mongodbClient';
import jsPDF from 'jspdf';
import { Test } from '../types/database';
import { getReports } from '../services/healthcareApi';
import type { UnifiedReport } from '../types/healthcare';

const addSectionTitle = (pdf: jsPDF, title: string, yPos: number, pageWidth: number) => {
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(title, 14, yPos);
  pdf.line(14, yPos + 2, pageWidth - 14, yPos + 2);
};

const buildResolvedProfile = (primaryProfile: any, fallbackProfile: any, nutrition: any) => ({
  full_name: primaryProfile?.full_name || fallbackProfile?.full_name,
  age: primaryProfile?.age ?? fallbackProfile?.age ?? null,
  gender: primaryProfile?.gender || fallbackProfile?.gender || null,
  weightKg: primaryProfile?.weightKg ?? fallbackProfile?.weightKg ?? nutrition?.profile?.weightKg ?? null,
  heightCm: primaryProfile?.heightCm ?? fallbackProfile?.heightCm ?? nutrition?.profile?.heightCm ?? null,
  stage: primaryProfile?.stage || fallbackProfile?.stage || null,
  bmi: typeof primaryProfile?.bmi === 'number'
    ? primaryProfile.bmi
    : typeof fallbackProfile?.bmi === 'number'
      ? fallbackProfile.bmi
      : typeof nutrition?.bmi === 'number'
        ? nutrition.bmi
        : null,
  bmiClass: primaryProfile?.bmiClass || fallbackProfile?.bmiClass || nutrition?.bmiClass || null,
});

const getPatientProfileAndNutrition = async (patientId?: string, patientSnapshot?: Record<string, any>) => {
  let nutrition: any = null;
  let patientProfile: any = null;

  if (!patientId) {
    return buildResolvedProfile(patientSnapshot || {}, {}, null);
  }

  try {
    const profileRes = await (mongodb as any)
      .from('patient_profiles')
      .select('*')
      .eq('id', patientId)
      .single();
    if (profileRes?.data) patientProfile = profileRes.data;

    const nutrRes = await (mongodb as any)
      .from('tests')
      .select('*')
      .eq('patient_id', patientId)
      .eq('test_type', 'nutrition')
      .order('created_at', { ascending: false });
    if (!nutrRes.error && Array.isArray(nutrRes.data) && nutrRes.data.length > 0) {
      nutrition = (nutrRes.data[0]?.result as any)?.nutrition || null;
    }
  } catch (e) {
    console.error('Error fetching patient details for report:', e);
  }

  return buildResolvedProfile(patientSnapshot || {}, patientProfile || {}, nutrition);
};

const drawLabeledValue = (
  pdf: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  valueColor: number[] = [0, 0, 0],
) => {
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 116, 139);
  pdf.text(label, x, y);
  pdf.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
  pdf.text(value, x + 30, y);
};

const drawContentBox = (
  pdf: jsPDF,
  title: string,
  contentLines: string[],
  yPos: number,
  pageWidth: number,
) => {
  const titleHeight = 7;
  const rendered = pdf.splitTextToSize(contentLines.join('\n'), pageWidth - 40);
  const boxHeight = Math.max(28, rendered.length * 5 + 14);

  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(14, yPos, pageWidth - 28, boxHeight, 4, 4, 'FD');
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(15, 23, 42);
  pdf.text(title, 20, yPos + titleHeight);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(51, 65, 85);
  pdf.text(rendered, 20, yPos + titleHeight + 8);

  return boxHeight;
};
const getUnifiedReportForTest = async (testId: string): Promise<UnifiedReport | null> => {
  try {
    const reports = await getReports().catch(() => []);
    return reports.find((report) => report.test_id === testId) || null;
  } catch (error) {
    console.error('Error loading unified report for PDF:', error);
    return null;
  }
};
const deriveRiskScoreFromResult = (result: any): number | null => {
  if (!result) return null;
  if (typeof result.riskScore === 'number') return result.riskScore > 1 ? result.riskScore : result.riskScore * 10;
  if (typeof result.probability === 'number') return result.probability * 10;
  if (typeof result.probabilityOfParkinsons === 'number') return result.probabilityOfParkinsons * 10;
  if (typeof result?.probabilities?.Parkinsons === 'number') return result.probabilities.Parkinsons * 10;
  return null;
};



/**
 * Generate a PDF report for a test and download it
 */
export const downloadTestReport = async (test: Test, patientName?: string) => {
  try {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const unifiedReport = await getUnifiedReportForTest(test.id);
    
    // Theme Colors
    const primaryColor = [28, 58, 97]; // Deep Navy Blue
    const secondaryColor = [100, 116, 139]; // Slate Gray
    const accentColor = [220, 38, 38]; // Red for high risk
    const successColor = [22, 163, 74]; // Green for low risk
    
    // --- Header Section ---
    pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.rect(0, 0, pageWidth, 28, 'F');
    
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text('CLINICAL EVALUATION REPORT', 14, 18);
    
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Neurology & Movement Disorders AI Assessment', pageWidth - 14, 18, { align: 'right' });

    // --- Patient Information & Vitals (Fetched from profile) ---
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('PATIENT PROFILE & VITALS', 14, 40);
    
    pdf.setDrawColor(200, 200, 200);
    pdf.line(14, 42, pageWidth - 14, 42);

    let yPos = 50;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);

    const profile = await getPatientProfileAndNutrition(test.patient_id, unifiedReport?.patientDetails || {});

    const leftColX = 14;
    const rightColX = pageWidth / 2 + 10;
    
    drawLabeledValue(pdf, 'Patient Name:', `${patientName || profile.full_name || test.patient_id.substring(0, 8).toUpperCase()}`, leftColX, yPos);
    drawLabeledValue(pdf, 'Date of Test:', `${dateStr}`, rightColX, yPos);
    yPos += 8;

    drawLabeledValue(pdf, 'Age / Gender:', `${profile.age || 'N/A'} Yrs / ${profile.gender || 'N/A'}`, leftColX, yPos);
    drawLabeledValue(pdf, 'Modality:', `${test.test_type.toUpperCase()}`, rightColX, yPos);
    yPos += 8;

    drawLabeledValue(pdf, 'Weight:', `${profile.weightKg ? profile.weightKg + ' kg' : 'N/A'}`, leftColX, yPos);
    drawLabeledValue(pdf, 'Height:', `${profile.heightCm ? profile.heightCm + ' cm' : 'N/A'}`, rightColX, yPos);
    yPos += 8;

    const bmiVal = typeof profile?.bmi === 'number' ? `${profile.bmi.toFixed(1)} (${profile.bmiClass || 'N/A'})` : 'N/A';
    drawLabeledValue(pdf, 'BMI:', bmiVal, leftColX, yPos);
    drawLabeledValue(pdf, 'Clinical Stage:', `${profile.stage || 'N/A'}`, rightColX, yPos, primaryColor);
    yPos += 14;

    // --- Diagnostic Summary ---
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('DIAGNOSTIC SUMMARY', 14, yPos);
    pdf.line(14, yPos + 2, pageWidth - 14, yPos + 2);
    yPos += 12;

    const result = test.result as any;
    if (result) {
      // Risk Score Box
      let riskScore = result.riskScore !== undefined ? result.riskScore : deriveRiskScoreFromResult(result) || 0;
      
      pdf.setFillColor(248, 250, 252);
      pdf.rect(14, yPos, pageWidth - 28, 24, 'F');
      
      pdf.setFontSize(10);
      pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      pdf.text('OVERALL RISK SCORE', 20, yPos + 8);
      
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      if (riskScore >= 7) pdf.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
      else if (riskScore <= 3) pdf.setTextColor(successColor[0], successColor[1], successColor[2]);
      else pdf.setTextColor(217, 119, 6); // Warning Orange
      
      pdf.text(`${riskScore.toFixed(1)} / 10`, 20, yPos + 18);

      pdf.setFontSize(10);
      pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      pdf.text('AI CLASSIFICATION', rightColX, yPos + 8);
      
      pdf.setFontSize(14);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`${result.label ? result.label.toUpperCase() : 'PENDING'}`, rightColX, yPos + 16);
      
      yPos += 30;
      
      // --- Severity Visual Bar Graph ---
      const barX = 14;
      const barY = yPos;
      const barWidth = pageWidth - 28;
      const barHeight = 6;
      
      // Green zone (0-3.5)
      pdf.setFillColor(successColor[0], successColor[1], successColor[2]);
      pdf.rect(barX, barY, barWidth * 0.35, barHeight, 'F');
      // Orange zone (3.5-7.0)
      pdf.setFillColor(217, 119, 6);
      pdf.rect(barX + (barWidth * 0.35), barY, barWidth * 0.35, barHeight, 'F');
      // Red zone (7.0-10.0)
      pdf.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
      pdf.rect(barX + (barWidth * 0.70), barY, barWidth * 0.30, barHeight, 'F');

      // Score Marker
      const markerPos = barX + (riskScore / 10) * barWidth;
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(0.5);
      pdf.line(markerPos, barY - 2, markerPos, barY + barHeight + 2);
      
      // Marker Triangle
      pdf.setFillColor(0, 0, 0);
      pdf.triangle(markerPos, barY - 2, markerPos - 2, barY - 5, markerPos + 2, barY - 5, 'F');

      pdf.setFontSize(8);
      pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
      pdf.text('Healthy', barX, barY + barHeight + 5);
      pdf.text('Moderate Risk', barX + (barWidth * 0.5), barY + barHeight + 5, { align: 'center' });
      pdf.text('High Risk', barX + barWidth, barY + barHeight + 5, { align: 'right' });

      yPos += 20;

      // --- AI Clinical Details & Markers ---
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0, 0, 0);
      pdf.text('PHYSIOLOGICAL FINDINGS & AI REASONING', 14, yPos);
      pdf.line(14, yPos + 2, pageWidth - 14, yPos + 2);
      yPos += 10;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(40, 40, 40);

      const detailsText = result.details || result.summary || result.reasoning;
      if (detailsText) {
        const textToPrint = typeof detailsText === 'string' ? detailsText : JSON.stringify(detailsText, null, 2);
        const lines = pdf.splitTextToSize(textToPrint, pageWidth - 28);
        pdf.text(lines, 14, yPos);
        yPos += lines.length * 5 + 4;
      } else {
        pdf.text('No detailed physiological analysis available for this modality.', 14, yPos);
        yPos += 10;
      }
      
      if (result.confidence !== undefined) {
        pdf.text(`Inference Confidence: ${(result.confidence * 100).toFixed(1)}%`, 14, yPos);
        yPos += 6;
      }
    } else {
      pdf.setFontSize(10);
      pdf.setTextColor(150, 150, 150);
      pdf.text('Analysis pending or unavailable.', 14, yPos);
      yPos += 10;
    }

    // --- Footer ---
    if (yPos > pageHeight - 60) {
      pdf.addPage();
      yPos = 20;
    } else {
      yPos += 10;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.text('Assessment Signature: _________________________________', 14, yPos);
    pdf.text('Date: ____________________', rightColX, yPos);

    // Bottom Footer
    const footerY = pageHeight - 12;
    pdf.setFillColor(241, 245, 249);
    pdf.rect(0, footerY - 6, pageWidth, 18, 'F');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(100, 100, 100);
    pdf.text('This report is generated by the Parkinson\'s Care AI Analysis Tool. It is intended to assist, not replace, formal medical diagnosis.', pageWidth / 2, footerY, { align: 'center' });
    pdf.text('Ref ID: ' + test.id, pageWidth / 2, footerY + 5, { align: 'center' });
    
    // Download
    const modality = test.test_type.toLowerCase();
    const fileName = `clinical-report-${modality}-${new Date(test.created_at).toISOString().split('T')[0]}.pdf`;
    pdf.save(fileName);
    
    return true;
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};

/**
 * Download test history as CSV
 */
export const downloadTestHistoryCSV = async (tests: Test[]) => {
  try {
    const headers = ['Date', 'Test Type', 'Risk Level', 'Risk Score', 'Confidence', 'Label'];
    const rows = tests.map(test => {
      const result = test.result as any;
      return [
        new Date(test.created_at).toLocaleString(),
        test.test_type,
        result?.riskLevel || 'N/A',
        result?.riskScore || 'N/A',
        result?.confidence ? (result.confidence * 100).toFixed(1) + '%' : 'N/A',
        result?.label || 'N/A'
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `test-history-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    return true;
  } catch (error) {
    console.error('Error generating CSV:', error);
    throw error;
  }
};

export const downloadUnifiedReportPdf = async (report: UnifiedReport, patientName?: string) => {
  try {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const primaryColor = [28, 58, 97];
    const secondaryColor = [100, 116, 139];
    const accentColor = [220, 38, 38];
    const successColor = [22, 163, 74];
    const patient = await getPatientProfileAndNutrition(report.patient_id, report.patientDetails || {});
    const doctor = report.doctorDetails || null;
    const summary = report.aiResults?.summary || {};
    const fusion = report.aiResults?.fusion as Record<string, any> | null;
    const reportDate = new Date(report.updated_at || report.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    pdf.rect(0, 0, pageWidth, 28, 'F');
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text('CLINICAL EVALUATION REPORT', 14, 18);
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Unified AI + Doctor Review', pageWidth - 14, 18, { align: 'right' });

    let yPos = 40;
    const leftColX = 14;
    const rightColX = pageWidth / 2 + 10;

    addSectionTitle(pdf, 'PATIENT PROFILE & VITALS', yPos, pageWidth);
    yPos += 10;
    drawLabeledValue(pdf, 'Patient Name:', patientName || patient.full_name || 'Patient', leftColX, yPos);
    drawLabeledValue(pdf, 'Report Date:', reportDate, rightColX, yPos);
    yPos += 8;

    drawLabeledValue(pdf, 'Age / Gender:', `${patient.age || 'N/A'} Yrs / ${patient.gender || 'N/A'}`, leftColX, yPos);
    drawLabeledValue(pdf, 'Clinical Stage:', `${patient.stage || 'N/A'}`, rightColX, yPos, primaryColor);
    yPos += 8;

    drawLabeledValue(pdf, 'Height / Weight:', `${patient.heightCm || 'N/A'} cm / ${patient.weightKg || 'N/A'} kg`, leftColX, yPos);
    drawLabeledValue(pdf, 'BMI:', typeof patient.bmi === 'number' ? `${patient.bmi.toFixed(1)} (${patient.bmiClass || 'N/A'})` : 'N/A', rightColX, yPos);
    yPos += 14;

    addSectionTitle(pdf, 'DIAGNOSTIC SUMMARY', yPos, pageWidth);
    yPos += 12;
    const riskScore = typeof summary.riskScore === 'number' ? summary.riskScore : null;
    pdf.setFillColor(248, 250, 252);
    pdf.rect(14, yPos, pageWidth - 28, 24, 'F');
    pdf.setFontSize(10);
    pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    pdf.text('OVERALL RISK SCORE', 20, yPos + 8);
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    if ((riskScore || 0) >= 7) pdf.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    else if ((riskScore || 0) <= 3) pdf.setTextColor(successColor[0], successColor[1], successColor[2]);
    else pdf.setTextColor(217, 119, 6);
    pdf.text(riskScore !== null ? `${riskScore.toFixed(1)} / 10` : 'N/A', 20, yPos + 18);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
    pdf.text('AI CLASSIFICATION', rightColX, yPos + 8);
    pdf.setFontSize(14);
    pdf.setTextColor(0, 0, 0);
    pdf.text(summary.label ? String(summary.label).toUpperCase() : 'PENDING', rightColX, yPos + 16);
    yPos += 32;

    const aiSummaryLines = [
      `Source Test Type: ${report.aiResults?.sourceTestType || 'fusion'}`,
      `Confidence: ${typeof summary.confidence === 'number' ? `${(summary.confidence * 100).toFixed(1)}%` : 'N/A'}`,
      '',
      'AI Recommendations:',
      ...((fusion?.recommendations?.length ? fusion.recommendations : ['Continue periodic monitoring and clinical review.']).map((item: string, index: number) => `${index + 1}. ${item}`)),
    ];
    pdf.setFontSize(10);
    pdf.setTextColor(40, 40, 40);
    const aiLines = pdf.splitTextToSize(aiSummaryLines.join('\n'), pageWidth - 28);
    pdf.text(aiLines, 14, yPos);
    yPos += aiLines.length * 5 + 6;

    if (fusion?.breakdown?.length) {
      addSectionTitle(pdf, 'FUSION BREAKDOWN', yPos, pageWidth);
      yPos += 12;
      fusion.breakdown.forEach((item: any) => {
        pdf.setTextColor(0, 0, 0);
        pdf.text(`${item.modality}: ${item.score?.toFixed?.(1) ?? item.score} / 10`, 14, yPos);
        pdf.setTextColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
        pdf.text(`Weight ${(Number(item.weight || 0) * 100).toFixed(0)}%`, rightColX, yPos);
        yPos += 6;
      });
      yPos += 4;
    }

    if (yPos > pageHeight - 90) {
      pdf.addPage();
      yPos = 20;
    }

    addSectionTitle(pdf, 'DOCTOR REVIEW & PRESCRIPTION', yPos, pageWidth);
    yPos += 10;

    const summaryHeight = drawContentBox(
      pdf,
      'Doctor Summary',
      [
        `Doctor: ${doctor?.full_name || 'Not assigned yet'}`,
        `Hospital: ${doctor?.hospital || 'N/A'}`,
        `Report Status: ${String(report.status || 'pending').charAt(0).toUpperCase()}${String(report.status || 'pending').slice(1)}`,
      ],
      yPos,
      pageWidth,
    );
    yPos += summaryHeight + 8;

    const notesHeight = drawContentBox(
      pdf,
      'Clinical Notes',
      [report.doctorNotes || 'Doctor notes have not been added yet.'],
      yPos,
      pageWidth,
    );
    yPos += notesHeight + 8;

    const prescriptionHeight = drawContentBox(
      pdf,
      'Prescription',
      report.prescription?.length ? report.prescription.map((item, index) => `${index + 1}. ${item}`) : ['No prescription added yet.'],
      yPos,
      pageWidth,
    );
    yPos += prescriptionHeight + 8;

    const suggestionsHeight = drawContentBox(
      pdf,
      'Suggestions',
      [report.suggestions || 'Doctor suggestions have not been added yet.'],
      yPos,
      pageWidth,
    );
    yPos += suggestionsHeight + 12;

    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Physician Signature: _________________________________', 14, yPos);
    pdf.text('Date: ____________________', rightColX, yPos);

    const footerY = pageHeight - 12;
    pdf.setFillColor(241, 245, 249);
    pdf.rect(0, footerY - 6, pageWidth, 18, 'F');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(100, 100, 100);
    pdf.text('This report combines AI analysis with doctor review and is intended to support clinical care, not replace diagnosis.', pageWidth / 2, footerY, { align: 'center' });
    pdf.text(`Ref ID: ${report.id}`, pageWidth / 2, footerY + 5, { align: 'center' });

    pdf.save(`clinical-report-${(report.aiResults?.sourceTestType || 'fusion').toLowerCase()}-${new Date(report.created_at).toISOString().split('T')[0]}.pdf`);
    return true;
  } catch (error) {
    console.error('Error generating unified report PDF:', error);
    throw error;
  }
};

/**
 * Upload prescription file to MongoDB storage
 */
export const uploadPrescription = async (userId: string, file: File) => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;
    
    const { error } = await mongodb.storage
      .from('prescriptions')
      .upload(fileName, file);
    
    if (error) throw error;
    
    return fileName;
  } catch (error) {
    console.error('Error uploading prescription:', error);
    throw error;
  }
};

/**
 * Get prescription public URL
 */
export const getPrescriptionUrl = (path: string) => {
  const publicUrl = mongodb.storage
    .from('prescriptions')
    .getPublicUrl(path);
  
  return publicUrl;
};
