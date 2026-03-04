import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEmployees } from '../hooks/useEmployees.js';
import { DocumentationBadge } from '../components/DocumentationStatus.js';
import './EmployeeList.css';

export function EmployeeList() {
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [search, setSearch] = useState('');
  const { employees, loading, error, refetch } = useEmployees({ status, search });

  return (
    <div className="employee-list-page">
      <header className="page-header">
        <h1>Employees</h1>
      </header>

      <div className="filters">
        <div className="filter-group">
          <label htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            data-testid="field-status"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <label htmlFor="search">Search</label>
          <input
            id="search"
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="field-search"
          />
        </div>
      </div>

      {loading && <div className="loading">Loading employees...</div>}

      {error && (
        <div className="error-message">
          <p>Error: {error}</p>
          <button onClick={refetch} data-testid="employee-list-retry-button">
            Retry
          </button>
        </div>
      )}

      {!loading && !error && employees.length === 0 && (
        <div className="empty-state">
          <p>No employees found.</p>
          {search && <p>Try adjusting your search criteria.</p>}
        </div>
      )}

      {!loading && !error && employees.length > 0 && (
        <table className="employees-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Age</th>
              <th>Age Band</th>
              <th>Status</th>
              <th>Documentation</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr
                key={employee.id}
                className={employee.status === 'archived' ? 'archived-row' : ''}
              >
                <td>
                  <Link to={`/employees/${employee.id}`} className="employee-name">
                    {employee.name}
                  </Link>
                </td>
                <td className="email-cell">{employee.email}</td>
                <td>{employee.age}</td>
                <td>
                  <span className={`age-band age-band-${employee.ageBand.replace('+', 'plus')}`}>
                    {employee.ageBand}
                  </span>
                </td>
                <td>
                  <span className={`status-badge status-${employee.status}`}>
                    {employee.status}
                  </span>
                </td>
                <td>
                  <DocumentationBadge
                    isComplete={employee.documentation.isComplete}
                    missingCount={employee.documentation.missingCount}
                    expiringCount={employee.documentation.expiringCount}
                  />
                </td>
                <td>
                  <Link to={`/employees/${employee.id}`} className="view-link">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
