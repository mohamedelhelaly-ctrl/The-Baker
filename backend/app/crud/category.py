from app.crud._taxonomy import TaxonomyCRUD
from app.models.category import Category


class CategoryCRUD(TaxonomyCRUD[Category]):
    model = Category


category_crud = CategoryCRUD()
