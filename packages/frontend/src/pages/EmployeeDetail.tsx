import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useEmployee } from '../hooks/useEmployees.js';
import { useDocumentActions } from '../hooks/useDocuments.js';
import { DocumentationStatus } from '../components/DocumentationStatus.js';
import { DocumentUpload } from '../components/DocumentUpload.js';
import type { DocumentType } from '@renewal/types';
import './EmployeeDetail.css';

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { employee: data, loading, error, refetch } = useEmployee(id);
  const {
    uploadDocument,
    markSafetyTrainingComplete,
    invalidateDocument,
    downloadDocument,
    loading: docLoading,
  } = useDocumentActions();

  const [showUpload, setShowUpload] = useState<DocumentType | null>(null);

  if (loading) {
    return (
      <div className="employee-detail">
        <div className="loading">Loading employee details...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="employee-detail">
        <div className="error-state">
          <p>Error: {error || 'Employee not found'}</p>
          <Link to="/employees">Back to Employees</Link>
        </div>
      </div>
    );
  }

  const { employee, documents, requiredDocuments, documentationStatus } = data;

  const handleUpload = async (
    employeeId: string,
    file: File,
    type: DocumentType,
    expiresAt?: string
  ) => {
    await uploadDocument(employeeId, file, type, expiresAt);
    setShowUpload(null);
    refetch();
  };

  const handleSafetyTraining = async () => {
    await markSafetyTrainingComplete(employee.id);
    refetch();
  };

  const handleInvalidate = async (docId: string) => {
    if (
      confirm('Are you sure you want to invalidate this document? This action cannot be undone.')
    ) {
      await invalidateDocument(docId);
      refetch();
    }
  };

  const handleDownload = async (docId: string) => {
    await downloadDocument(docId);
  };

  const getDocumentsOfType = (type: DocumentType) =>
    documents.filter((d) => d.type === type && !d.invalidatedAt);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="employee-detail">
      <header className="detail-header">
        <div>
          <Link to="/employees" className="back-link">
            ← Back to Employees
          </Link>
          <h1>{employee.name}</h1>
          <p className="email">{employee.email}</p>
        </div>
        <div className="header-actions">
        </div>
      </header>

      <div className="detail-grid">
        <section className="detail-section">
          <h2>Profile</h2>
          <dl className="profile-info">
            <dt>Age</dt>
            <dd>{employee.age} years old</dd>
            <dt>Age Band</dt>
            <dd>
              <span className={`age-band age-band-${employee.ageBand.replace('+', 'plus')}`}>
                {employee.ageBand}
              </span>
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={`status-badge status-${employee.status}`}>{employee.status}</span>
            </dd>
            <dt>Member Since</dt>
            <dd>{formatDate(employee.createdAt)}</dd>
          </dl>
        </section>

        <section className="detail-section">
          <h2>Documentation Status</h2>
          <DocumentationStatus status={documentationStatus} />
        </section>
      </div>

      <section className="detail-section documents-section">
        <h2>Required Documents</h2>

        {/* Parental Consent */}
        {requiredDocuments.parentalConsent && (
          <div className="document-type">
            <div className="document-header">
              <h3>Parental Consent Form</h3>
              {requiredDocuments.coppaDisclosure && (
                <span className="coppa-badge">COPPA Required</span>
              )}
            </div>
            <div className="document-list">
              {getDocumentsOfType('parental_consent').map((doc) => (
                <div key={doc.id} className="document-item">
                  <span className="doc-status valid">✓ Uploaded</span>
                  <span className="doc-date">Uploaded {formatDate(doc.uploadedAt)}</span>
                  <div className="doc-actions">
                    <button
                      onClick={() => handleDownload(doc.id)}
                      disabled={docLoading}
                      data-testid={`doc-download-button-${doc.id}`}
                    >
                      Download
                    </button>
                    <button
                      onClick={() => handleInvalidate(doc.id)}
                      className="invalidate-button"
                      disabled={docLoading}
                      data-testid={`doc-revoke-button-${doc.id}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
              {getDocumentsOfType('parental_consent').length === 0 && (
                <div className="document-missing">
                  <span>Not uploaded</span>
                  <button
                    onClick={() => setShowUpload('parental_consent')}
                    data-testid="doc-upload-parental-consent-button"
                  >
                    Upload Document
                  </button>
                </div>
              )}
            </div>
            {showUpload === 'parental_consent' && (
              <div className="upload-panel">
                <DocumentUpload
                  employeeId={employee.id}
                  documentType="parental_consent"
                  onUpload={handleUpload}
                  onSuccess={() => setShowUpload(null)}
                  disabled={docLoading}
                />
                <button
                  onClick={() => setShowUpload(null)}
                  className="cancel-upload"
                  data-testid="doc-upload-cancel-button"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Work Permit */}
        {requiredDocuments.workPermit && (
          <div className="document-type">
            <h3>Work Permit</h3>
            <div className="document-list">
              {getDocumentsOfType('work_permit').map((doc) => (
                <div key={doc.id} className="document-item">
                  <span className="doc-status valid">✓ Uploaded</span>
                  <span className="doc-date">
                    Uploaded {formatDate(doc.uploadedAt)}
                    {doc.expiresAt && ` · Expires ${formatDate(doc.expiresAt)}`}
                  </span>
                  <div className="doc-actions">
                    <button
                      onClick={() => handleDownload(doc.id)}
                      disabled={docLoading}
                      data-testid={`doc-download-button-${doc.id}`}
                    >
                      Download
                    </button>
                    <button
                      onClick={() => handleInvalidate(doc.id)}
                      className="invalidate-button"
                      disabled={docLoading}
                      data-testid={`doc-revoke-button-${doc.id}`}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
              {getDocumentsOfType('work_permit').length === 0 && (
                <div className="document-missing">
                  <span>Not uploaded</span>
                  <button
                    onClick={() => setShowUpload('work_permit')}
                    data-testid="doc-upload-work-permit-button"
                  >
                    Upload Document
                  </button>
                </div>
              )}
            </div>
            {showUpload === 'work_permit' && (
              <div className="upload-panel">
                <DocumentUpload
                  employeeId={employee.id}
                  documentType="work_permit"
                  requireExpiration
                  onUpload={handleUpload}
                  onSuccess={() => setShowUpload(null)}
                  disabled={docLoading}
                />
                <button
                  onClick={() => setShowUpload(null)}
                  className="cancel-upload"
                  data-testid="doc-upload-work-permit-cancel-button"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Safety Training */}
        {requiredDocuments.safetyTraining && (
          <div className="document-type">
            <h3>Safety Training</h3>
            <div className="document-list">
              {getDocumentsOfType('safety_training').map((doc) => (
                <div key={doc.id} className="document-item">
                  <span className="doc-status valid">✓ Complete</span>
                  <span className="doc-date">Completed {formatDate(doc.uploadedAt)}</span>
                  <div className="doc-actions">
                    <button
                      onClick={() => handleInvalidate(doc.id)}
                      className="invalidate-button"
                      disabled={docLoading}
                      data-testid={`doc-invalidate-button-${doc.id}`}
                    >
                      Mark Incomplete
                    </button>
                  </div>
                </div>
              ))}
              {getDocumentsOfType('safety_training').length === 0 && (
                <div className="document-missing">
                  <span>Not completed</span>
                  <button
                    onClick={handleSafetyTraining}
                    disabled={docLoading}
                    data-testid="doc-safety-training-complete-button"
                  >
                    Mark as Complete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {!requiredDocuments.parentalConsent &&
          !requiredDocuments.workPermit &&
          !requiredDocuments.safetyTraining && (
            <p className="no-docs-required">
              No documentation required for employees 18 and older.
            </p>
          )}
      </section>

      {/* Document History */}
      {documents.some((d) => d.invalidatedAt) && (
        <section className="detail-section">
          <h2>Document History</h2>
          <div className="document-history">
            {documents
              .filter((d) => d.invalidatedAt)
              .map((doc) => (
                <div key={doc.id} className="history-item">
                  <span className="history-type">{formatDocType(doc.type)}</span>
                  <span className="history-dates">
                    Uploaded {formatDate(doc.uploadedAt)} · Invalidated{' '}
                    {formatDate(doc.invalidatedAt!)}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatDocType(type: string): string {
  switch (type) {
    case 'parental_consent':
      return 'Parental Consent';
    case 'work_permit':
      return 'Work Permit';
    case 'safety_training':
      return 'Safety Training';
    default:
      return type;
  }
}
