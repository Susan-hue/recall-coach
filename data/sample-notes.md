# Database Normalization

Normalization is the process of organizing data in a database to reduce redundancy and improve data integrity.
A primary key is a column or set of columns that uniquely identifies each row in a table.
A foreign key is a column that references the primary key of another table to link the two tables.
First normal form requires that every column holds atomic values and that there are no repeating groups.
Second normal form requires the table to be in first normal form and every non-key column to depend on the whole primary key.
Third normal form requires the table to be in second normal form with no transitive dependencies between non-key columns.
A transitive dependency is when a non-key column depends on another non-key column instead of the primary key.
Denormalization is the deliberate addition of redundancy to speed up read-heavy queries.
