CREATE TABLE IF NOT EXISTS tidb_zero_documents (
  id INT NOT NULL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(64) NOT NULL,
  embedding VECTOR(3) NOT NULL,
  FULLTEXT KEY ft_title_body (title, body)
);
