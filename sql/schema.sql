CREATE TABLE IF NOT EXISTS tidb_zero_documents (
  id INT NOT NULL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  search_text TEXT NOT NULL,
  category VARCHAR(64) NOT NULL,
  embedding VECTOR(3) NOT NULL,
  FULLTEXT KEY ft_search_text (search_text)
);
