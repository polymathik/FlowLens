from app.base import Base


class User(Base):
    def save(self):
        self.validate()
        return self.name()

    def name(self):
        return "user"


class Admin(User):
    @property
    def level(self):
        return 1

    @level.setter
    def level(self, value):
        self._level = value
