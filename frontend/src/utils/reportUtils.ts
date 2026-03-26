import { mongodb } from '../lib/mongodbClient';
import jsPDF from 'jspdf';
import { Test } from '../types/database';

/**
 * Generate a PDF report for a test and download it
 */
export const downloadTestReport = async (test: Test) => {
  try {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    
    // Header
    pdf.setFontSize(20);
    pdf.setTextColor(40, 40, 40);
    pdf.text('Parkinson\'s Disease Test Report', pageWidth / 2, 20, { align: 'center' });
    
    // Divider line
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, 25, pageWidth - 20, 25);
    
    // Test Information
    pdf.setFontSize(12);
    pdf.setTextColor(60, 60, 60);
    pdf.text(`Test Type: ${test.test_type.charAt(0).toUpperCase() + test.test_type.slice(1)} Analysis`, 20, 35);
    pdf.text(`Date: ${new Date(test.created_at).toLocaleString()}`, 20, 42);
    pdf.text(`Test ID: ${test.id}`, 20, 49);
    
    // Result Section
    if (test.result) {
      const result = test.result as any;
      
      pdf.setFontSize(14);
      pdf.setTextColor(40, 40, 40);
      pdf.text('Analysis Results', 20, 60);
      
      pdf.setFontSize(11);
      pdf.setTextColor(60, 60, 60);
      
      let yPos = 70;
      
      if (result.label) {
        pdf.text(`Prediction: ${result.label}`, 20, yPos);
        yPos += 7;
      }
      
      if (result.confidence !== undefined) {
        pdf.text(`Confidence: ${(result.confidence * 100).toFixed(1)}%`, 20, yPos);
        yPos += 7;
      }
      
      if (result.probability !== undefined) {
        pdf.text(`Probability: ${(result.probability * 100).toFixed(1)}%`, 20, yPos);
        yPos += 7;
      }
      
      if (result.riskLevel) {
        pdf.text(`Risk Level: ${result.riskLevel}`, 20, yPos);
        yPos += 7;
      }
      
      if (result.riskScore !== undefined) {
        pdf.text(`Risk Score: ${result.riskScore}/10`, 20, yPos);
        yPos += 7;
      }
      
      // Detailed Analysis
      if (result.details) {
        yPos += 10;
        pdf.setFontSize(14);
        pdf.setTextColor(40, 40, 40);
        pdf.text('Detailed Analysis', 20, yPos);
        yPos += 10;
        
        pdf.setFontSize(10);
        pdf.setTextColor(60, 60, 60);
        const details = typeof result.details === 'string' 
          ? result.details 
          : JSON.stringify(result.details, null, 2);
        
        const splitDetails = pdf.splitTextToSize(details, pageWidth - 40);
        pdf.text(splitDetails, 20, yPos);
      }
    } else {
      pdf.setFontSize(11);
      pdf.setTextColor(150, 150, 150);
      pdf.text('Analysis pending...', 20, 70);
    }
    
    // Footer
    const footerY = pdf.internal.pageSize.getHeight() - 20;
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text('This report is generated automatically and should be reviewed by a medical professional.', pageWidth / 2, footerY, { align: 'center' });
    pdf.text('Parkinson\'s Care App - AI-Assisted Analysis', pageWidth / 2, footerY + 5, { align: 'center' });
    
    // Download
    const fileName = `test-report-${test.test_type}-${new Date(test.created_at).toISOString().split('T')[0]}.pdf`;
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

/**
 * Upload prescription file to MongoDB storage
 */
export const uploadPrescription = async (userId: string, file: File) => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;
    
    const { data, error } = await mongodb.storage
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
  const { data } = mongodb.storage
    .from('prescriptions')
    .getPublicUrl(path);
  
  return data.publicUrl;
};
