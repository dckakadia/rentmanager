import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const generateRentReceipt = (property, payment) => {
  const doc = new jsPDF();
  
  // Header
  doc.setFillColor(59, 130, 246); // Blue
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('RENT RECEIPT', 105, 25, { align: 'center' });
  
  // Receipt Details
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Receipt No: #${payment.id}-${property.id}`, 15, 50);
  doc.text(`Date: ${new Date(payment.payment_date).toLocaleDateString()}`, 15, 55);
  doc.text(`Month: ${payment.month_year}`, 15, 60);

  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(15, 65, 195, 65);

  // Property & Tenant Info
  doc.setFont('helvetica', 'bold');
  doc.text('PROPERTY DETAILS', 15, 75);
  doc.setFont('helvetica', 'normal');
  doc.text(`Unit: ${property.room_number}`, 15, 82);
  doc.text(`Type: ${property.property_type.toUpperCase()}`, 15, 87);

  doc.setFont('helvetica', 'bold');
  doc.text('TENANT DETAILS', 110, 75);
  doc.setFont('helvetica', 'normal');
  doc.text(`Name: ${property.tenant_name}`, 110, 82);
  doc.text(`Phone: ${property.tenant_phone}`, 110, 87);

  // Payment Breakdown Table
  autoTable(doc, {
    startY: 100,
    head: [['Description', 'Amount (INR)']],
    body: [
      ['Base Rent', `Rs. ${payment.base_rent.toLocaleString()}`],
      ['Electricity Bill', `Rs. ${payment.electricity_bill.toLocaleString()}`],
      [{ content: 'Total Due', styles: { fontStyle: 'bold' } }, { content: `Rs. ${payment.total_due.toLocaleString()}`, styles: { fontStyle: 'bold' } }],
      [{ content: 'Amount Paid', styles: { fontStyle: 'bold', textColor: [16, 185, 129] } }, { content: `Rs. ${payment.amount_paid.toLocaleString()}`, styles: { fontStyle: 'bold', textColor: [16, 185, 129] } }],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    margin: { left: 15, right: 15 },
  });

  // Footer
  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(10);
  doc.text('Payment Status:', 15, finalY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(payment.payment_status === 'paid' ? [16, 185, 129] : [245, 158, 11]);
  doc.text(payment.payment_status.toUpperCase(), 45, finalY);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  if (payment.notes) {
    doc.text('Notes:', 15, finalY + 10);
    doc.setFontSize(9);
    doc.text(payment.notes, 15, finalY + 16, { maxWidth: 180 });
  }

  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('This is a computer-generated receipt and does not require a signature.', 105, 280, { align: 'center' });
  doc.text('RentManager v1.0', 105, 285, { align: 'center' });

  // Save PDF
  doc.save(`Receipt_${property.room_number}_${payment.month_year}.pdf`);
};

export const generateMeterCollectionSheet = (readings) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const d = new Date();
  const monthStr = d.toLocaleString('default', { month: 'short' });
  const yearStr = d.getFullYear().toString().substr(-2);
  doc.text(`Meter Readings Collection Sheet - ${monthStr} '${yearStr}`, 105, 15, { align: 'center' });
  
  const tableData = readings.map((r, i) => [
    i + 1,
    r.room_number || '',
    r.tenant_name || '',
    r.meter_number || '',
    r.last_reading ? `${r.last_reading} (${new Date(r.last_reading_date).toLocaleDateString()})` : '-',
    '' 
  ]);

  autoTable(doc, {
    startY: 20,
    head: [['No.', 'Unit', 'Tenant Name', 'Meter No', 'Past Reading', 'Current Reading']],
    body: tableData,
    theme: 'grid',
    headStyles: { 
      fillColor: [240, 240, 240], 
      textColor: [0, 0, 0], 
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 8.5
    },
    bodyStyles: {
      minCellHeight: 7,
      valign: 'middle'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { halign: 'center', cellWidth: 20 },
      2: { cellWidth: 45 },
      3: { halign: 'center', cellWidth: 35 },
      4: { halign: 'center', cellWidth: 40 },
      5: { halign: 'center' } 
    },
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      overflow: 'linebreak'
    },
    margin: { top: 15, bottom: 5, left: 10, right: 10 }
  });

  doc.autoPrint();
  const pdfBlobUrl = doc.output('bloburl');
  const newTab = window.open(pdfBlobUrl, '_blank');
  
  // If browser popup blocker blocked the new tab, fallback to direct download
  if (!newTab) {
    alert("Popup blocked! Downloading the PDF to your computer instead.");
    doc.save(`Meter_Collection_${monthStr}_${yearStr}.pdf`);
  }
};

export const generateElectricityReportPdf = (electricityData, selectedMonth) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  const monthName = new Date(selectedMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' });
  doc.text(`Monthly Electricity Report - ${monthName}`, 105, 15, { align: 'center' });
  
  const tableData = electricityData.map((item) => [
    item.room_number || '',
    item.meter_number || '-',
    item.tenant_name || 'Vacant',
    item.previous_reading || '0',
    item.current_reading || '0',
    item.units_consumed || '0',
    `Rs. ${(item.cost || 0).toLocaleString()}`
  ]);

  const totalUnits = electricityData.reduce((sum, i) => sum + (i.units_consumed || 0), 0);
  const totalCost = electricityData.reduce((sum, i) => sum + (i.cost || 0), 0);

  tableData.push([
    { content: 'TOTAL CONSUMPTION', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: totalUnits.toString(), styles: { fontStyle: 'bold', textColor: [245, 158, 11] } },
    { content: `Rs. ${totalCost.toLocaleString()}`, styles: { fontStyle: 'bold' } }
  ]);

  autoTable(doc, {
    startY: 20,
    head: [['Unit', 'Meter No.', 'Tenant', 'Previous', 'Current', 'Units', 'Cost (Rs. 9/u)']],
    body: tableData,
    theme: 'grid',
    headStyles: { 
      fillColor: [240, 240, 240], 
      textColor: [0, 0, 0], 
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 8.5
    },
    bodyStyles: {
      minCellHeight: 8,
      valign: 'middle'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 20 },
      1: { halign: 'center', cellWidth: 25 },
      2: { cellWidth: 40 },
      3: { halign: 'center', cellWidth: 25 },
      4: { halign: 'center', cellWidth: 25 },
      5: { halign: 'center', cellWidth: 20 },
      6: { halign: 'right' } 
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      overflow: 'linebreak'
    },
    margin: { top: 15, bottom: 5, left: 10, right: 10 }
  });

  doc.autoPrint();
  const pdfBlobUrl = doc.output('bloburl');
  const newTab = window.open(pdfBlobUrl, '_blank');
  
  if (!newTab) {
    alert("Popup blocked! Downloading the PDF to your computer instead.");
    doc.save(`Electricity_Report_${monthName}.pdf`);
  }
};
